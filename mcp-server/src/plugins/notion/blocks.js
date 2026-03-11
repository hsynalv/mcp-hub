/**
 * Notion block builder helpers.
 *
 * AI sends simple objects like:
 *   { type: "heading_1", text: "Project Plan" }
 *   { type: "paragraph", text: "This project aims to..." }
 *   { type: "todo", text: "Set up database", checked: false }
 *   { type: "bullet", text: "Use PostgreSQL" }
 *   { type: "divider" }
 *
 * These helpers convert them to the Notion block API format.
 */

function richText(text) {
  return [{ type: "text", text: { content: String(text ?? "") } }];
}

/**
 * Convert a simple block descriptor to a Notion block object.
 */
export function toNotionBlock(block) {
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return {
        object: "block",
        type: block.type,
        [block.type]: { rich_text: richText(block.text) },
      };

    case "paragraph":
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(block.text) },
      };

    case "bullet":
    case "bulleted_list_item":
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(block.text) },
      };

    case "numbered":
    case "numbered_list_item":
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: richText(block.text) },
      };

    case "todo":
    case "to_do":
      return {
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: richText(block.text),
          checked: block.checked ?? false,
        },
      };

    case "code":
      return {
        object: "block",
        type: "code",
        code: {
          rich_text: richText(block.text),
          language: block.language ?? "plain text",
        },
      };

    case "quote":
      return {
        object: "block",
        type: "quote",
        quote: { rich_text: richText(block.text) },
      };

    case "callout":
      return {
        object: "block",
        type: "callout",
        callout: {
          rich_text: richText(block.text),
          icon: { type: "emoji", emoji: block.emoji ?? "💡" },
        },
      };

    case "divider":
      return { object: "block", type: "divider", divider: {} };

    default:
      // Fallback: treat unknown types as paragraph
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(block.text ?? String(block.type)) },
      };
  }
}

/**
 * Convert an array of simple block descriptors to Notion block objects.
 * Notion allows max 100 blocks per append request.
 */
export function toNotionBlocks(blocks) {
  return blocks.slice(0, 100).map(toNotionBlock);
}

/**
 * Build a standard task database schema for inline databases.
 *
 * Properties:
 *  - Name (title) — required by Notion
 *  - Status (select): Todo / In Progress / Done
 *  - Priority (select): High / Medium / Low
 *  - Due Date (date)
 *  - Notes (rich_text)
 */
export function taskDatabaseSchema(title = "Tasks") {
  return {
    title: [{ type: "text", text: { content: title } }],
    properties: {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: "Todo", color: "gray" },
            { name: "In Progress", color: "blue" },
            { name: "Done", color: "green" },
            { name: "Blocked", color: "red" },
          ],
        },
      },
      Priority: {
        select: {
          options: [
            { name: "High", color: "red" },
            { name: "Medium", color: "yellow" },
            { name: "Low", color: "gray" },
          ],
        },
      },
      "Due Date": { date: {} },
      Notes: { rich_text: {} },
    },
  };
}

// ── Database property schema builders ────────────────────────────────────────

const NOTION_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const NUMBER_FORMATS = ["number", "number_with_commas", "percent", "dollar", "canadian_dollar", "euro", "pound", "yen", "ruble", "rupee", "won", "yuan", "real", "lira", "rupiah", "franc", "hong_kong_dollar", "new_zealand_dollar", "krona", "norwegian_krone", "mexican_peso", "rand", "new_taiwan_dollar", "danish_krone", "zloty", "baht", "forint", "koruna", "shekel", "chilean_peso", "philippine_peso", "dirham", "colombian_peso", "riyal", "ringgit", "leu", "argentine_peso", "uruguayan_peso", "singapore_dollar"];

function randomColor(index) {
  return NOTION_COLORS[(index + 1) % NOTION_COLORS.length];
}

/**
 * Build a Notion database property schema object from a simple descriptor.
 *
 * Supported types:
 *   title, rich_text, number, select, multi_select, status,
 *   date, checkbox, url, email, phone_number, people,
 *   created_time, created_by, last_edited_time, last_edited_by
 *
 * @param {string} type - Property type
 * @param {object} options - Type-specific options
 *   - select / multi_select: { options: string[] | { name, color }[] }
 *   - number: { format: string }  e.g. "dollar", "percent", "number"
 *   - status: { options: string[], groups?: { name, color, optionNames }[] }
 * @returns {object} Notion property schema
 */
export function buildNotionProperty(type, options = {}) {
  switch (type) {
    case "title":
      return { title: {} };

    case "rich_text":
    case "text":
      return { rich_text: {} };

    case "number":
      return { number: { format: options.format || "number" } };

    case "select": {
      const opts = (options.options || []).map((o, i) =>
        typeof o === "string"
          ? { name: o, color: options.colors?.[i] || randomColor(i) }
          : { name: o.name, color: o.color || randomColor(i) }
      );
      return { select: { options: opts } };
    }

    case "multi_select": {
      const opts = (options.options || []).map((o, i) =>
        typeof o === "string"
          ? { name: o, color: options.colors?.[i] || randomColor(i) }
          : { name: o.name, color: o.color || randomColor(i) }
      );
      return { multi_select: { options: opts } };
    }

    case "status": {
      const statusOpts = (options.options || ["Not Started", "In Progress", "Done"]).map((o, i) =>
        typeof o === "string" ? { name: o, color: randomColor(i) } : o
      );
      const groups = options.groups || [
        { name: "To-do",       color: "gray",  option_ids: [] },
        { name: "In progress", color: "blue",  option_ids: [] },
        { name: "Complete",    color: "green", option_ids: [] },
      ];
      return { status: { options: statusOpts, groups } };
    }

    case "date":
      return { date: {} };

    case "checkbox":
      return { checkbox: {} };

    case "url":
      return { url: {} };

    case "email":
      return { email: {} };

    case "phone_number":
      return { phone_number: {} };

    case "people":
      return { people: {} };

    case "files":
      return { files: {} };

    case "created_time":
      return { created_time: {} };

    case "created_by":
      return { created_by: {} };

    case "last_edited_time":
      return { last_edited_time: {} };

    case "last_edited_by":
      return { last_edited_by: {} };

    default:
      // Unknown type — fallback to rich_text
      return { rich_text: {} };
  }
}

/**
 * Build a Notion database properties schema from an array of column descriptors.
 *
 * Column descriptor: { name: string, type: string, ...options }
 * One column with type "title" is required (auto-added as "Name" if missing).
 *
 * Example:
 *   buildDatabaseSchema([
 *     { name: "Task", type: "title" },
 *     { name: "Status", type: "select", options: ["Todo", "In Progress", "Done"] },
 *     { name: "Due Date", type: "date" },
 *     { name: "Effort", type: "number", format: "number" },
 *   ])
 */
export function buildDatabaseSchema(columns = []) {
  const properties = {};
  let hasTitleCol = false;

  for (const col of columns) {
    const { name, type, ...opts } = col;
    properties[name] = buildNotionProperty(type, opts);
    if (type === "title") hasTitleCol = true;
  }

  // Notion requires exactly one title property
  if (!hasTitleCol) {
    properties["Name"] = { title: {} };
  }

  return properties;
}

/**
 * Build a Notion page property object for a task row.
 *
 * Input:
 *   { name, status, priority, dueDate, notes }
 *
 * Output: Notion properties object ready for POST /pages
 */
export function toTaskProperties({ name, status, priority, dueDate, notes }) {
  const props = {
    Name: { title: richText(name ?? "Untitled") },
  };

  if (status) {
    props.Status = { select: { name: status } };
  }
  if (priority) {
    props.Priority = { select: { name: priority } };
  }
  if (dueDate) {
    props["Due Date"] = { date: { start: dueDate } };
  }
  if (notes) {
    props.Notes = { rich_text: richText(notes) };
  }

  return props;
}
