# Safety is admin-set access profiles per user and per device

Decided 24 Nov 2026 (grill decisions 19, 27, 30, 31, 61). There is no fixed list of forbidden actions. Every action type (send, post, reply as the user, delete, overwrite, share, publish, push, money) can be off, ask-every-time, or auto, set by the admin for each user and each of that user's devices, with a risk warning on every grant. A device is a linked chat identity or a web session. By default a member approves their own risky actions; the admin can take approval over for chosen users or actions. New profiles start with the shell gate on risky-only and a network allowlist.

## Considered Options

- A fixed always-ask list, as in Nod: simpler, but cannot express a restricted device or a trusted admin.
- Roles only (admin, member, guest): too coarse for one person with a personal phone and a shared tablet.

## Consequences

Every tool call goes through one policy function, including connector, MCP and engine built-in tools. Three presets (Restricted, Standard, Trusted) keep setup short. A person using someone else's phone and chat account cannot be told apart from its owner.
