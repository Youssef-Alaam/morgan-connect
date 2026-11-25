# "Sign in with ChatGPT" for an open-source, self-hosted agent

Checked 2026-11-24. Lookup by Gemini from OpenAI's developer pages and the Pi repositories. **Nothing in this file was re-read on the live pages by the reviewer** (the lookup returned redirect links, not page addresses). Treat it as a lead to verify before M7, not as a finding. Not legal advice.

## What the lookup reports

| Question                                                           | Reported answer                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does an open-source app need approval?                             | No. Open-source and locally run personal projects register themselves at first sign-in (`client_id=dynamic_agent_client` plus the app's real name). Paid or remotely hosted apps need OpenAI's approval through an interest form |
| Required flow                                                      | OpenID Connect with PKCE, no client secret, a callback on `http://127.0.0.1:<port>` (not `localhost`), and a stable random id per host (`ext_agent_host_id`)                                                                     |
| Limited to coding?                                                 | No. The docs are said to cover personal assistants and productivity tools as well                                                                                                                                                |
| Which models and how much                                          | Whatever the user's ChatGPT plan allows, drawn from the same allowance; the user sets a weekly cap per app in ChatGPT's settings                                                                                                 |
| Several people on one install, each with their own ChatGPT account | **No explicit rule found.** The docs describe keeping several accounts apart on one host                                                                                                                                         |
| A condition that matters                                           | The terms are quoted as requiring that stored sign-in tokens "must be local and under the user's control", "not in a remote or managed environment"                                                                              |
| Pi's two logins                                                    | Pi's older `openai-codex` login reuses the Codex CLI's own client id. Pi's newer `/login openai` uses the official self-registration flow                                                                                        |

## What this means, if it holds up

1. **Never use Pi's `openai-codex` login.** Borrowing another product's client id is the grey pattern the earlier research warned about. Only the official flow is a candidate.
2. **The token-storage condition is the real problem for a multi-user install.** If Morgan runs on a server and holds a member's ChatGPT token there, the token is not "local and under the user's control" for that member. The clean case is narrow: a person who runs the install on their own machine and signs in with their own ChatGPT account. A member of someone else's install is at best grey.
3. Under the terms rule (decision 55: grey routes are off by default and need opt-in), the likely outcome is: ChatGPT sign-in offered only to the admin of an install on their own machine, and labelled; members use API keys. That is a question for the owner before M7.
4. The loopback callback means the sign-in has to be completed in a browser on the same machine as the server, which does not fit a remote server without extra steps.

## To verify before M7

- The token-storage clause and the open-source eligibility wording, on OpenAI's live terms page.
- Any written rule about several users on one self-hosted install.
- Which login the Pi version we pin actually ships.
