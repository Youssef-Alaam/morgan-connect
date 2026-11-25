# Glossary

One meaning per word. Use these words in the spec, tickets, code and UI.

- **Install:** one running copy of Morgan Connect, with its own database, bot and admin.
- **Admin:** the person who set up an install. Sets everyone's access profiles and budgets.
- **Member:** any other account on an install.
- **Workspace:** a group inside an install (Family, Work team) with its own data, apps and budgets. A person can be in several.
- **Device:** a linked chat identity (a WhatsApp number, a Telegram user id) or a signed-in web session. Not a physical phone.
- **Access profile:** the set of rules for one (user, device): each action type is off, ask, or auto, plus the shell-gate level and which heavy tools are granted.
- **Action type:** a kind of risky action: send, post, reply as the user, delete, overwrite, share, publish, push, money.
- **Shell gate:** how bash commands in the sandbox are checked: strict (every command), risky-only, or off.
- **Heavy tools:** the sandbox computer and the browser. Granted per user.
- **Sandbox:** a private container where Morgan runs commands for one user. Holds no credentials and reaches only allowlisted network addresses.
- **Turn:** everything Morgan does from one message to its final reply.
- **Engine:** the software that runs the model loop (send conversation, receive tool calls, run tools, repeat). One per provider SDK.
- **Engine port:** the single internal interface every engine sits behind (`open / prompt / steer / abort / usage`).
- **Route:** one way of reaching one provider (for example "Anthropic by API key"). Each has a terms verdict, a source and a last-verified date in the policy file.
- **Policy file:** the list of routes and their terms status. Can switch a route off.
- **S1 / S2:** S1 is a subscriber using only their own plan. S2 is someone else consuming it. No provider allows S2.
- **Tier:** fast, strong or boss: the three model levels a provider profile defines.
- **Team mode:** boss plans, managers and workers execute, boss reviews. Used for big jobs or on `/team`.
- **Trust check:** a separate, small model call before a gated action. It must quote the user's own words, and the quote must cover the action.
- **Safety model:** the install-wide model, on an admin API key, that runs the trust check.
- **Approval:** a person's yes to one exact action with exact arguments. Used once.
- **Untrusted content:** anything Morgan read rather than was told by its user (web pages, mail, files). Never treated as instructions.
- **Audit log:** the append-only record of actions, approvals, costs and admin reads.
- **Connector:** a link to an outside app (Gmail, Calendar, Notion). Reached through Composio, an MCP server, or the install's own OAuth app.
- **Vault:** a user's Obsidian vault in a GitHub repo, used as a knowledge source. Morgan writes only new files in agreed zones.
- **Memory:** a saved fact about a user, backed by the quote it came from. Saved on request, or on a yes to a suggestion.
- **Quiet hours:** a user's do-not-disturb window in their time zone.
- **Stateless:** an app server that keeps nothing in its own memory between requests, so several copies can run.
- **Job queue:** a to-do list in Postgres; a job survives a crashed worker.
- **Row-level security:** a database rule that lets a query see only the current user's rows.
- **Envelope encryption:** each secret has its own key, and those keys are encrypted by one master key kept outside the database.
- **Master key:** the key file that unlocks all stored credentials. Lose it and every provider and app must be reconnected.
- **Evals:** test scenarios for the AI's behaviour. The **holdout set** is never used for tuning and decides releases.
- **Release gate:** tests green, typecheck clean, zero unsafe actions on the holdout set.
- **24-hour window:** WhatsApp's rule that free-form messages are allowed only within 24 hours of the user's last message; after that a pre-approved **template** is needed.
