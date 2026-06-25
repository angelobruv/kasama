# Kasama

**Open-source feedback layer — highlight any line, drop a comment, on any page.**

Kasama drops a commenting layer onto any web page. Select text to comment on exactly those words, or drop a numbered pin anywhere. Comments thread, reply, and resolve, and sync to your own server. No screenshots, no "see comment 14 in the doc" — feedback lives on the real page.

> **Cloud version coming** — managed hosting plus a Claude Code loop that *acts* on the feedback (reads each comment, implements the change, ships it). Join the waiting list at **[usekasama.xyz](https://usekasama.xyz)**.

## Why

Every comment tool — Figma, Notion, Google Docs — treats a comment as a note that waits for a human. Kasama's bet is that a comment is an **instruction**. The open-source layer captures feedback on the live page; the [cloud](https://usekasama.xyz) closes the loop with an agent that implements and ships it.

## Quickstart (self-host)

```bash
git clone https://github.com/angelobruv/kasama && cd kasama
npm install
npm start                      # http://localhost:3000 — in-memory store
# …or with persistence:
DATABASE_URL=postgres://…  npm start
```

Open <http://localhost:3000> for a live demo page you can comment on.

## Embed on your own page

One script tag:

```html
<script src="https://your-host/kasama.js"
        data-slug="my-page"
        data-root="article"></script>
```

| attribute   | what it does                                              | default            |
|-------------|-----------------------------------------------------------|--------------------|
| `data-slug` | the comment-store key for this page                       | the URL path       |
| `data-root` | CSS selector for the commentable area                     | `body`             |
| `data-api`  | base URL of your Kasama server                            | same origin        |

## How it works

- **Widget** — [`src/kasama.js`](src/kasama.js) + [`src/kasama.css`](src/kasama.css). The highlight / pin / thread UI. Vanilla JS, no build step, no dependencies. Highlights re-anchor across reloads by character-offset + quote.
- **Server** — [`server.js`](server.js). Serves the widget and a tiny annotations API: `GET`/`POST /api/annotations/:slug`. Uses Postgres when `DATABASE_URL` is set, otherwise an in-memory store.
- A page's comments are a single JSON array, keyed by slug. That's the whole storage contract — bring your own backend if you like.

## Roadmap

- [ ] Per-user identity / lightweight auth
- [ ] Real-time sync (currently a 15s poll)
- [ ] Neutralise internal class-name prefix (currently `er-*`)
- [ ] **The Claude Code loop** — an agent that reads open comments and ships the change (this is the [cloud](https://usekasama.xyz) product)

## License

[MIT](LICENSE) © 2026
