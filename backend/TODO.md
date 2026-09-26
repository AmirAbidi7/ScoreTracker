- [x] Set up the websocket connection
- [x] Set up basic REST for scoreboard currently:
  - [x] Create a new scoreboard
  - [x] Delete a scoreboard
  - [x] Fetch the current scoreboard (or join an existing one)
  - [x] Fetch all scoreboards (Will be by id next time)
  - [ ] Changing a scoreboard — deliberately not here. `PUT /api/scoreboard`
    used to take a whole board from the request body, which let any HTTP client
    author a score; it is gone. Players and scores change over the websocket
    (`scoreboard:intent` → `applyIntent`), where a client says what changed and
    the server works out the board. Do not add a REST write back.

- [x] Sync scoreboard to websocket
- [x] Join a scoreboard by code over REST
