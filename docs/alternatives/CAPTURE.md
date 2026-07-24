# Alternatives — screenshot assets

The repo README's "Three UIs, one backend" section references three images that
live in this folder. Capture them from the running dev servers (all three apps
share one backend, so the **same trip** renders in each) and save with these exact
names:

| File | App | URL | What to show |
|------|-----|-----|--------------|
| `board.png` | Trip Board (winner) | http://localhost:5175 | A trip's board: category columns, a few option cards, the Decided column, the cost strip |
| `deck.png` | Command Deck (frozen) | http://localhost:5173 | The same trip's detail: console rows + right-rail cost ledger |
| `feed.png` | Trip Feed (frozen) | http://localhost:5174 | The same trip's detail: option cards + the Plan / 💶 Cost tab |

Tips for a clean shot: sign in, open a trip that has a couple of priced/voted
options (and ideally one locked decision so the cost breakdown is populated),
capture at a normal desktop width (~1280px), and keep them consistent (same trip,
same theme). PNG preferred.
