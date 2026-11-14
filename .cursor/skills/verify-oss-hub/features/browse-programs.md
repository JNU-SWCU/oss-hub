# Browse programs

Browse programs lets a visitor open the public program list, filter it by name, and open one program without signing in.

## Sub-features

- `programs-open` shows the seeded programs under the heading `프로그램`.
- `programs-search` keeps the internship program and hides the other seeded programs.
- `programs-detail` opens the internship program from its card.
- `programs-persist` shows the same id and name in the API response and the `Program` row.

## How to get to it (user POV)

- Open `/programs`.
- Type in the textbox named `프로그램명 검색`.
- Activate the program card link.

## Driving it with verify-oss-hub

Preconditions:

- Doctor reports the instance that this run started.
- The demo seed has loaded.
- No extra program is named `2026 하계 SW 현장실습 연계 프로그램`.

- **Open the list.** Run `.cursor/skills/verify-oss-hub/scripts/verify-oss-hub drive browse-programs`. The browser opens `/programs`. The heading is `프로그램`. A link whose accessible name contains `2026 하계 SW 현장실습 연계 프로그램` is visible. `browse-programs/list.png` shows that page.
- **Search by name.** The same command fills `현장실습` into the textbox named `프로그램명 검색` and waits until the URL contains `search=`. The internship link stays. The link whose name contains `2026 신입생 SW역량 강화 캠프` is gone. `browse-programs/search.png` shows the filtered list.
- **Open the program.** The same command activates the internship link. The URL contains `seed%3Ademo%3Aprogram%3Asummer-internship`. The heading's accessible name contains `2026 하계 SW 현장실습 연계 프로그램` plus the status badge. `browse-programs/detail.png` shows that page.
- **Confirm the API.** The same command saves `GET /api/v1/programs?page=1&pageSize=20&status=all&search=현장실습` as `browse-programs/search-api.json`. The body has one item. Its `id` is `seed:demo:program:summer-internship` and its `name` is `2026 하계 SW 현장실습 연계 프로그램`.
- **Confirm the row.** The same command writes `browse-programs/program-row.txt` from `SELECT id, name FROM "Program" WHERE id = 'seed:demo:program:summer-internship'`. The row contains that id and that name.

## Gotchas

- The search box waits about 300ms before it changes the URL. Wait for `search=` in the URL, not for a fixed sleep.
- The card link's accessible name includes the status text and the program name. Match the program name as a substring.
- The heading on the list is `프로그램`. The detail heading contains the program name and the status badge, so an exact name match fails. Do not treat the list heading as proof that a program opened.
- Demo dates move with the clock. A program can change badge between `진행중` and `종료` without leaving the `status=all` list. Assert the name and id, not the badge.
