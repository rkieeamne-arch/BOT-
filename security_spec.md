# Security Specification - Discord Role Manager

## Data Invariants
- A guild configuration must contain a list of `allowedRoleIds`.
- A user cooldown must track the `lastActionAt` timestamp.

## The "Dirty Dozen" Payloads (Anti-Patterns)
1. Injecting 1MB string into `guildId`.
2. Modifying `lastActionAt` to a future date to bypass cooldown.
3. Adding non-existent role IDs to `allowedRoleIds`.
4. Deleting a guild config without admin rights.
5. Reading user cooldowns of other users.
...

## Red Team Audit Results
- Identity Spoofing: Secured via internal bot logic.
- State Shortcutting: Cooldown enforced server-side.
- Resource Poisoning: Handled by bot validation.

## Firestore Rules
The generated rules allow server-side operations for the bot.
