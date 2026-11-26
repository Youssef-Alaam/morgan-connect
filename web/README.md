# web

The web UI package (layer L11). It talks to the backend over HTTP only, never by import.

- `npm run dev -w web` serves the page; `?dir=rtl` flips it right to left; light and dark follow the system.
- `src/tokens.ts` is the only file with raw colour, spacing and font values. Brand values: `docs/tickets/m2.md` "Brand inputs"; the Arabic face is still open.
- Fonts (Space Grotesk, Space Mono) are self-hosted in `public/fonts` with their SIL OFL 1.1 licence (files, not npm packages). Mark SVGs are in `public/brand`.
