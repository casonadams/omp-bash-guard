# Changelog

## [0.3.1](https://github.com/casonadams/omp-bash-guard/compare/v0.3.0...v0.3.1) (2026-09-26)


### Features

* configure release-please to bump patch numbers and style prompt in high-visibility yellow ([88ab047](https://github.com/casonadams/omp-bash-guard/commit/88ab04716ec0b0fa0fe3f8c4617b9e178c808389))
* **prompt:** expand SRE and developer engineering rules and bump maxTokens to 256 ([0269682](https://github.com/casonadams/omp-bash-guard/commit/0269682ac10222f076fbbedf8bb94e93df34fffd))
* **prompt:** use XML tag boundaries and raw JSON output contract ([0794490](https://github.com/casonadams/omp-bash-guard/commit/0794490efed4befa01909120f6fdf078cb537aa8))
* **ui:** display audit impact first, render full command, and loop back to menu on Esc ([3f6d120](https://github.com/casonadams/omp-bash-guard/commit/3f6d120a679bb0d9c99cf853738d864028c01af1))
* **ui:** reference command in a single line instead of duplicating entire script inside modal ([0cee3af](https://github.com/casonadams/omp-bash-guard/commit/0cee3af0a13175c76ce916ea1959c78255066530))
* **ui:** safely bound large multiline scripts with head, tail, and line count indicators ([9046835](https://github.com/casonadams/omp-bash-guard/commit/90468351320909ef1420559f2223bba8a3fd87fd))
* **ui:** use Allow and Deny with feedback options with optional feedback input ([2355108](https://github.com/casonadams/omp-bash-guard/commit/235510884ab95f13f8897a460b9a1b2f928e2ae0))


### Bug Fixes

* **guard:** add resilient output parser handling think blocks, unescaped quotes, and prose fallbacks ([d33191e](https://github.com/casonadams/omp-bash-guard/commit/d33191e26264c940837fea119b64fa23cb7ab662))
* move prompt to src/guard-prompt.md so workspace agents do not misread it as repo instructions ([bc2604f](https://github.com/casonadams/omp-bash-guard/commit/bc2604f418a8bdb0c23b1e34fa5e7e181a75047a))
* **ui:** preserve clean line break between audit reason and prompt question ([59d0272](https://github.com/casonadams/omp-bash-guard/commit/59d0272e1574d5a6f42ef6a075a9531efa6423dc))
* **ui:** provide syntax-highlighted code preview on Proceed for full multiline visibility ([3139b2c](https://github.com/casonadams/omp-bash-guard/commit/3139b2c476d8499349dddfa37d8cbe179852ccba))
* **ui:** simplify askDialog options by removing redundant nested previews ([9717b56](https://github.com/casonadams/omp-bash-guard/commit/9717b56884fff161fdf2158d8b95b4e29e75bc05))

## [0.3.0](https://github.com/casonadams/omp-bash-guard/compare/v0.2.0...v0.3.0) (2026-09-26)


### Features

* initial release of omp-bash-guard (0.1.0) ([ae10c1a](https://github.com/casonadams/omp-bash-guard/commit/ae10c1ab260c54d3c1401286c984b35c1505abb7))


### Bug Fixes

* **ui:** format askDialog question and option previews cleanly ([ed71a15](https://github.com/casonadams/omp-bash-guard/commit/ed71a15383165c30998656be617eeaa9e5fb06fe))

## [0.2.0](https://github.com/casonadams/omp-bash-guard/compare/omp-bash-guard-v0.1.0...omp-bash-guard-v0.2.0) (2026-09-26)


### Features

* initial release of omp-bash-guard (0.1.0) ([ae10c1a](https://github.com/casonadams/omp-bash-guard/commit/ae10c1ab260c54d3c1401286c984b35c1505abb7))


### Bug Fixes

* **ui:** format askDialog question and option previews cleanly ([ed71a15](https://github.com/casonadams/omp-bash-guard/commit/ed71a15383165c30998656be617eeaa9e5fb06fe))
