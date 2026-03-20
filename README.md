# pi-storelayer

AI agent for [Storelayer](https://storelayer.io) — build loyalty programs, rules, and promotions through natural conversation in [pi](https://github.com/badlogic/pi).

## Install

```bash
pi --install git:github.com/storelayer/pi-storelayer
```

Or add to your `~/.pi/settings.json`:

```json
{
  "packages": ["git:github.com/storelayer/pi-storelayer"]
}
```

## Setup

Set your Storelayer API credentials via environment variables or `.env` file:

```bash
# Environment variables
export STORELAYER_API_KEY=your-api-key
export STORELAYER_API_URL=https://api.storelayer.io  # optional, default
export STORELAYER_PROJECT_ID=your-project-id         # optional

# Or create .env in your project directory
echo 'STORELAYER_API_KEY=your-api-key' >> .env
```

Or create `.storelayer.json`:

```json
{
  "apiUrl": "https://api.storelayer.io",
  "apiKey": "your-api-key",
  "projectId": "your-project-id"
}
```

## Usage

Start pi and talk naturally:

```
> Give 200 points for every purchase over $100

> Create a 15% discount promotion for VIP users, valid until end of March

> Set up a referral program: 500 points for both the referrer and the new user

> Show me all active rules in my project

> Test the "Gold Tier Bonus" rule with a $150 purchase from a gold user
```

## Tools

Tools are **auto-generated from the resource-registry** on startup (72 tools across 13 domains):

| Tool                        | Domain              | Example Actions                                                                        |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `storelayer_project`        | Rules & Config (16) | `add_rule`, `update_rule`, `list_rules`, `test_conditions`, `test_rule`, `get_summary` |
| `storelayer_promotions`     | Promotions (18)     | `create`, `evaluate_cart`, `create_coupon`, `bulk_create_coupons`, `duplicate`         |
| `storelayer_referral`       | Referrals (12)      | `create_code`, `apply_code`, `validate_code`, `get_leaderboard`, `get_stats`           |
| `storelayer_stores`         | Stores (9)          | `create_store`, `list_stores`, `create_facility`, `list_facilities`                    |
| `storelayer_external_users` | Users (7)           | `get_user`, `lookup_user`, `search`, `register`, `update`                              |
| `storelayer_resources`      | Resources (6)       | `add`, `list`, `resolve`, `remove`                                                     |
| `storelayer_surveys`        | Surveys (6)         | `create`, `list`, `submit_response`, `get_stats`                                       |
| `storelayer_wallet`         | Wallet (5)          | `get_balance`, `earn`, `spend`, `list_transactions`, `list_assets`                     |
| `storelayer_support`        | Support (5)         | `create_ticket`, `list_tickets`, `update_ticket`, `get_stats`                          |
| `storelayer_agent`          | Agent (5)           | `memory_store`, `memory_search`, `load_skill`, `list_tools`                            |
| `storelayer_events`         | Events (4)          | `ingest`, `list`, `get`, `get_stats`                                                   |
| `storelayer_workflows`      | Workflows (4)       | `list`, `get`, `get_full`, `get_stats`                                                 |
| `storelayer_user_workflows` | User Workflows (3)  | `list`, `get`, `get_stats`                                                             |

If the tool manifest can't be fetched, a fallback `storelayer_api` tool is registered for raw API calls.

## Architecture

```
resource-registry (source of truth)
  → GET /public/tools (manifest API)
    → pi-storelayer auto-generates domain tools
      → POST /public/tools/:name/execute
```

No duplicated tool definitions — everything comes from the registry.

## Skill

The `storelayer-builder` skill is automatically loaded when relevant. It teaches the AI:

- Storelayer's condition/action syntax
- Common loyalty program patterns
- How to translate plain-language goals into rules
- Auto-resource creation (event, wallet, user, history resources are created automatically)

## Commands

| Command       | Description            |
| ------------- | ---------------------- |
| `/storelayer` | Show connection status |

## Examples

### Create a Rule

```
You: "Reward 100 points for purchases over $50 from verified users"

Agent: I'll create this rule:
  Rule: "Verified User Purchase Reward"
  Trigger: purchase event
  Conditions:
    - event.amount >= 50 (AND)
    - user.verified == true
  Action: reward 100 points

Shall I create it?

You: yes

Agent: Created rule "Verified User Purchase Reward" (rule_abc123)
Resources auto-created: event (purchase), user (internal)
Let me test it with sample data...
Test passed — rule matches a $75 purchase from a verified user
```

### Create a Promotion

```
You: "20% off for gold tier users, max 3 uses per user"

Agent: Here's the promotion I'll create:
  Promotion: "Gold Tier 20% Discount"
  Discount: 20% off cart total
  Conditions:
    - user.tier equals "gold"
  Limits: 3 uses per user
  Valid: immediately, no end date

Create it?
```
