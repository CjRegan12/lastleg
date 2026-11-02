# Last Leg design system

The product is a sweat room. People open it at 10pm with the game on, phone in one hand, heart rate up, waiting on one more leg. Every design choice serves that moment: legible from arm's length, state readable in a glance, the "one leg away" moment unmistakable.

## The one bold thing

Amber is the brand. The app is named after the one-leg-away state, so that state's color is the identity, not a decoration. Amber appears only where it means "this slip is one leg from cashing" and in the brand mark. Nothing else is amber. The rest of the interface is quiet ink so that when amber shows up, the room feels it.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| ink | `#0A0B0D` | Screen background. True near-black, not navy. |
| surface | `#14161A` | Cards, sheets, tab bar. |
| raised | `#1C1F25` | Pressed/selected surfaces, inputs. |
| line | `#272B33` | Hairlines. Borders encode grouping; they are not decoration. |
| text | `#F3F1EC` | Primary. Warm off-white, easier at night than pure white. |
| muted | `#8F949C` | Secondary text, timestamps, labels. |
| amber | `#FFB020` | One leg away. Brand. |
| amberInk | `#2A1F06` | Amber on dark fills (badge backgrounds). |
| live | `#6AA6FF` | In progress. |
| won | `#3DDC84` | Cashed. |
| lost | `#FF5C5C` | Dead. |
| flat | `#6B7280` | Push, void, pending. |

Status colors are only ever used for status. Buttons, links and focus use text-on-raised or amber, never live-blue. No gradients as decoration; the only glow in the app is the amber edge on a one-leg-away card.

## Type

One family, two widths: **Barlow** for body and **Barlow Condensed** for display and numbers. Condensed is the scoreboard vernacular: tall numerals, tight tracking, reads across a room.

| Role | Face | Size / line | Weight |
| --- | --- | --- | --- |
| display | Barlow Condensed | 40 / 42 | 700, tracking -0.5 |
| title | Barlow Condensed | 28 / 30 | 700 |
| number | Barlow Condensed | 22 / 24 | 600, tabular |
| heading | Barlow | 17 / 22 | 600 |
| body | Barlow | 15 / 21 | 400 |
| small | Barlow | 13 / 18 | 400 |
| micro | Barlow | 11 / 14 | 500 |

Sentence case everywhere. No all-caps labels, no eyebrow labels, no middle-dot meta strings. Odds and money are always `number` style with tabular figures so columns line up.

## Layout

Left-aligned, 16pt gutters, 12pt between cards, 8pt inside groups. Cards have radius 14; chips and badges radius 999; inputs radius 10. One shadow only (the amber glow). Everything else is flat on ink with a hairline.

Screen anatomy: large condensed title at top-left, one primary action at most per screen placed where the thumb lands (bottom or top-right), content below.

```
┌──────────────────────────────┐
│ Rooms                    (PN)│   display title, avatar
│                              │
│ ┌──────────────────────────┐ │
│ │ Sunday Sweats     3 live │ │   room card: name, live count,
│ │ ●●● +4   Jake is 1 away  │ │   avatar stack, hottest line
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ ...                      │ │
│ └──────────────────────────┘ │
│                              │
│ [ Rooms ] [ Live ] [ Community ] [ You ] │  tab bar
└──────────────────────────────┘
```

## Motion

One orchestrated moment: when a slip transitions to one-leg-away, its card's amber edge breathes once (scale 1 → 1.01 → 1, glow in) and a haptic fires. Everything else is instant or system default. No entrance animations on lists. Respect reduce-motion.

## Voice

Plain verbs, sentence case, second person. Buttons say what happens: "Create room", "Join with code", "Add slip". Empty states give the next action, not a mood. Errors say what went wrong and what to do.

## Rules for builders

- Never a hex outside `constants/theme.ts`.
- Status color only from `statusColor()`.
- Amber only for one-leg-away and the brand mark.
- Numbers in `number` style, tabular.
- No all-caps, no eyebrows, no decorative dividers, no gradients.
