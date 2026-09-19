### Fixed

- `JSON.parse` refuses a text whose arrays and objects nest past 256 levels with the reason `depth_limit_exceeded`, instead of answering a stack-overflow message for a text nested thousands of levels deep.
