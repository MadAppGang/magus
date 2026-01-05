# HTML/CSS Style Guide

This document summarizes key rules and best practices for HTML and CSS.

## 1. General Rules

- **Protocol:** Use HTTPS for all embedded resources
- **Indentation:** Indent by 2 spaces. Do not use tabs
- **Capitalization:** Use only lowercase for element names, attributes, selectors, properties
- **Trailing Whitespace:** Remove all trailing whitespace
- **Encoding:** Use UTF-8. Specify `<meta charset="utf-8">` in HTML

## 2. HTML Style Rules

- **Document Type:** Use `<!doctype html>`
- **HTML Validity:** Use valid HTML (validate with W3C validator)
- **Semantics:** Use HTML elements according to their purpose:
  - Use `<p>` for paragraphs, not for spacing
  - Use `<button>` for clickable actions, not `<div>`
  - Use `<nav>`, `<header>`, `<main>`, `<footer>` for page structure
- **Multimedia Fallback:** Provide `alt` text for images
- **Separation of Concerns:** Keep structure (HTML), presentation (CSS), and behavior (JS) separate
- **Type Attributes:** Omit `type` attributes for stylesheets and scripts

## 3. HTML Formatting Rules

- Use a new line for every block, list, or table element
- Indent child elements
- Use double quotation marks (`""`) for attribute values
- Self-closing tags: Use `<img />` not `<img>`

### Example

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Page Title</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
      </nav>
    </header>
    <main>
      <article>
        <h1>Article Title</h1>
        <p>Content goes here.</p>
      </article>
    </main>
  </body>
</html>
```

## 4. CSS Style Rules

- **CSS Validity:** Use valid CSS
- **Class Naming:** Use meaningful, generic names with hyphens:
  - Good: `.video-player`, `.site-navigation`, `.btn-primary`
  - Bad: `.vid`, `.red-text`, `.left`
- **ID Selectors:** Avoid using ID selectors for styling. Prefer class selectors
- **Shorthand Properties:** Use shorthand where possible (`padding`, `margin`, `font`)
- **Units:**
  - Omit units for `0` values: `margin: 0;`
  - Include leading `0`s for decimals: `opacity: 0.8;`
- **Hexadecimal:** Use 3-character hex where possible: `#fff` not `#ffffff`
- **!important:** Avoid using `!important`

## 5. CSS Formatting Rules

- **Declaration Order:** Alphabetize declarations within a rule, or group by type
- **Indentation:** Indent all block content
- **Semicolons:** Use a semicolon after every declaration
- **Spacing:**
  - Space after property colon: `font-weight: bold;`
  - Space before opening brace: `.foo {`
  - New line for each selector and declaration
- **Rule Separation:** Separate rules with a blank line
- **Quotation Marks:** Use single quotes for attribute selectors: `[type='text']`

### Example

```css
/* Component: Button */
.btn {
  background-color: #007bff;
  border: none;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
  display: inline-block;
  font-size: 1rem;
  padding: 0.5rem 1rem;
  text-align: center;
}

.btn:hover {
  background-color: #0056b3;
}

.btn-secondary {
  background-color: #6c757d;
}
```

## 6. Responsive Design

- Use mobile-first approach
- Define breakpoints consistently
- Use relative units (`rem`, `em`, `%`) over fixed (`px`)
- Test at common breakpoints: 320px, 768px, 1024px, 1440px

## 7. Accessibility

- Ensure sufficient color contrast (WCAG AA: 4.5:1 for text)
- Don't rely on color alone to convey information
- Ensure interactive elements are keyboard accessible
- Use focus styles for keyboard navigation

**BE CONSISTENT.** When editing code, match the existing style.
