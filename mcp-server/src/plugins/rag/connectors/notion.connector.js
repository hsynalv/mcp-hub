/**
 * Notion Source Connector for RAG
 * 
 * Indexes Notion pages and databases
 */

import { SourceConnector, SourceDocument } from "../rag-connectors.js";

export class NotionConnector extends SourceConnector {
  constructor(config) {
    super(config);
    this.name = "notion";
    this.type = "notion";
    this.token = config.token || process.env.NOTION_API_KEY;
    this.rootPageId = config.rootPageId || process.env.NOTION_ROOT_PAGE_ID;
    this.includeDatabases = config.includeDatabases ?? true;
  }

  async checkHealth() {
    if (!this.token) return false;
    try {
      const response = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": "2022-06-28",
        },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async crawl(options = {}) {
    const docs = [];

    // Search for pages and databases
    const results = await this.search(options.query);

    for (const item of results) {
      if (item.object === "page") {
        docs.push(new SourceDocument(
          `notion:page:${item.id}`,
          this.name,
          "page",
          item.id,
          {
            title: this.extractTitle(item),
            createdAt: item.created_time,
            updatedAt: item.last_edited_time,
            tags: ["page"],
          }
        ));
      } else if (item.object === "database" && this.includeDatabases) {
        docs.push(new SourceDocument(
          `notion:database:${item.id}`,
          this.name,
          "database",
          item.id,
          {
            title: this.extractTitle(item),
            createdAt: item.created_time,
            updatedAt: item.last_edited_time,
            tags: ["database"],
          }
        ));

        // Also index database rows
        const rows = await this.queryDatabase(item.id);
        for (const row of rows) {
          docs.push(new SourceDocument(
            `notion:row:${row.id}`,
            this.name,
            "database_row",
            `${item.id}/${row.id}`,
            {
              title: this.extractRowTitle(row),
              createdAt: row.created_time,
              updatedAt: row.last_edited_time,
              parentDatabase: item.id,
              tags: ["database_row"],
            }
          ));
        }
      }
    }

    return docs;
  }

  async hasChanged(doc, lastIndexedAt) {
    if (!doc.metadata.updatedAt) return true;
    return new Date(doc.metadata.updatedAt) > new Date(lastIndexedAt);
  }

  async extract(doc) {
    switch (doc.type) {
      case "page":
        return this.extractPage(doc);
      case "database_row":
        return this.extractDatabaseRow(doc);
      default:
        return "";
    }
  }

  async getMetadata(doc) {
    return doc.metadata;
  }

  // Notion API helpers
  async search(query = "") {
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        page_size: 100,
      }),
    });

    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data = await response.json();
    return data.results || [];
  }

  async getPageContent(pageId) {
    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!response.ok) throw new Error(`Failed to get page content: ${response.status}`);
    const data = await response.json();
    return this.blocksToText(data.results || []);
  }

  async queryDatabase(databaseId) {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (!response.ok) throw new Error(`Failed to query database: ${response.status}`);
    const data = await response.json();
    return data.results || [];
  }

  async extractPage(doc) {
    const content = await this.getPageContent(doc.path);
    return `# ${doc.metadata.title}\n\n${content}`;
  }

  async extractDatabaseRow(doc) {
    const rowId = doc.path.split("/").pop();
    const response = await fetch(`https://api.notion.com/v1/pages/${rowId}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!response.ok) throw new Error(`Failed to get row: ${response.status}`);
    const data = await response.json();
    
    // Extract properties as text
    const properties = this.propertiesToText(data.properties);
    return `# ${doc.metadata.title}\n\n${properties}`;
  }

  extractTitle(item) {
    if (item.properties?.title?.title?.[0]?.plain_text) {
      return item.properties.title.title[0].plain_text;
    }
    if (item.properties?.Name?.title?.[0]?.plain_text) {
      return item.properties.Name.title[0].plain_text;
    }
    return "Untitled";
  }

  extractRowTitle(row) {
    // Try to find a title property
    for (const [key, value] of Object.entries(row.properties || {})) {
      if (value.type === "title" && value.title?.[0]?.plain_text) {
        return value.title[0].plain_text;
      }
    }
    return "Untitled";
  }

  blocksToText(blocks) {
    const lines = [];
    
    for (const block of blocks) {
      const text = this.blockToText(block);
      if (text) lines.push(text);
    }
    
    return lines.join("\n\n");
  }

  blockToText(block) {
    switch (block.type) {
      case "paragraph":
        return this.richTextToString(block.paragraph?.rich_text);
      case "heading_1":
        return `# ${this.richTextToString(block.heading_1?.rich_text)}`;
      case "heading_2":
        return `## ${this.richTextToString(block.heading_2?.rich_text)}`;
      case "heading_3":
        return `### ${this.richTextToString(block.heading_3?.rich_text)}`;
      case "bulleted_list_item":
        return `- ${this.richTextToString(block.bulleted_list_item?.rich_text)}`;
      case "numbered_list_item":
        return `1. ${this.richTextToString(block.numbered_list_item?.rich_text)}`;
      case "code":
        const lang = block.code?.language || "";
        return `\`\`\`${lang}\n${this.richTextToString(block.code?.rich_text)}\n\`\`\``;
      case "quote":
        return `> ${this.richTextToString(block.quote?.rich_text)}`;
      default:
        return "";
    }
  }

  richTextToString(richText) {
    if (!richText || !Array.isArray(richText)) return "";
    return richText.map(t => t.plain_text || "").join("");
  }

  propertiesToText(properties) {
    const lines = [];
    for (const [key, value] of Object.entries(properties || {})) {
      const text = this.propertyToText(value);
      if (text) {
        lines.push(`**${key}:** ${text}`);
      }
    }
    return lines.join("\n");
  }

  propertyToText(prop) {
    switch (prop.type) {
      case "title":
        return prop.title?.map(t => t.plain_text).join("") || "";
      case "rich_text":
        return prop.rich_text?.map(t => t.plain_text).join("") || "";
      case "select":
        return prop.select?.name || "";
      case "multi_select":
        return prop.multi_select?.map(s => s.name).join(", ") || "";
      case "status":
        return prop.status?.name || "";
      case "url":
        return prop.url || "";
      case "email":
        return prop.email || "";
      case "phone_number":
        return prop.phone_number || "";
      case "date":
        return prop.date?.start || "";
      case "checkbox":
        return prop.checkbox ? "Yes" : "No";
      default:
        return "";
    }
  }
}

export default NotionConnector;
