# Changelog

## [0.2.0](https://github.com/stefaneicher/voice-bridge/compare/v0.1.0...v0.2.0) (2026-11-11)


### Neue Funktionen

* **agents:** show Copilot session titles in the popup ([2df8455](https://github.com/stefaneicher/voice-bridge/commit/2df845538d5ee70afb7c60a55947199403956f94))
* hotkeys with modifier combinations and mouse buttons ([6d2554b](https://github.com/stefaneicher/voice-bridge/commit/6d2554b91e972805b338ae1b4bbf6024dc212e3f))
* **input:** cancel recording and transcription with Escape ([b65d59b](https://github.com/stefaneicher/voice-bridge/commit/b65d59b420b55babaeabb003389d5f2353cff8f2))
* **stt:** disable polishing by default ([4f2f40a](https://github.com/stefaneicher/voice-bridge/commit/4f2f40acfb57d98f004e640a9cd8c42d6289ce97))
* **stt:** show the transcript live while recording ([5f34e5f](https://github.com/stefaneicher/voice-bridge/commit/5f34e5fbd24e3fbb4fdfc7351afec22cc1feee48))
* **ui:** quieter overlays that stay in place and on top ([89cccd2](https://github.com/stefaneicher/voice-bridge/commit/89cccd2142728b9da0a220dd140952cb93a23fd2))


### Fehlerbehebungen

* **ci:** publish the npm tarball by path, not as a git shorthand ([d254483](https://github.com/stefaneicher/voice-bridge/commit/d254483cb969558d26d3bfc9c6ab60cbc469eb04))
* **ci:** publish the npm tarball by path, not as a git shorthand ([baed9e5](https://github.com/stefaneicher/voice-bridge/commit/baed9e50f00ec2d95d368633b7439202452d771e))
* **cli:** reject unknown options with a hint instead of spawning them ([0eeaf19](https://github.com/stefaneicher/voice-bridge/commit/0eeaf195aeb135de87f9e855c73e339e36c22dbe))
* ignore EPIPE when the starting terminal is gone ([762c3a9](https://github.com/stefaneicher/voice-bridge/commit/762c3a977f5f45e2faf439c037ca7d2b77650a6b))
* **input:** accept injected mouse side buttons as hotkeys ([db03c8d](https://github.com/stefaneicher/voice-bridge/commit/db03c8d1efd77d49f7bd47395a1218f275e241d2))
* **stt:** never deliver an answer from the polishing model ([e43425c](https://github.com/stefaneicher/voice-bridge/commit/e43425c0839e0757d6d261bf297f73111621342a))
* **stt:** strip prompt fragments that leak into transcripts ([5b88de8](https://github.com/stefaneicher/voice-bridge/commit/5b88de8dcd8975a331d361be21aff6450268666f))
* **ui:** open settings tall enough to show speech recognition without scrolling ([23a2ec5](https://github.com/stefaneicher/voice-bridge/commit/23a2ec59f199c7a8bdf10442712b29dbf4474b18))
* **ui:** readable hotkey labels in settings ([e737245](https://github.com/stefaneicher/voice-bridge/commit/e7372456246b8173fb588c974900cad84547f822))


### Dokumentation

* add status and download badges to the README ([e35c340](https://github.com/stefaneicher/voice-bridge/commit/e35c340c69b667d698e49c567beccbce162320f2))
* plan Copilot session selection in the popup (ADR-015, T-023..T-025) ([3283353](https://github.com/stefaneicher/voice-bridge/commit/3283353c05c5e0da19ddf67ff810956190a4b4ff))


### Diverses

* release 0.2.0 ([ebc0a45](https://github.com/stefaneicher/voice-bridge/commit/ebc0a45f5fd2201eed29597f0c0f88195151749a))
