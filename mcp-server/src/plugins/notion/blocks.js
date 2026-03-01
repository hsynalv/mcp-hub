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
