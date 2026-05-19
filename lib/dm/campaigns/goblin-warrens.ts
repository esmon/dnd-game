import { type Campaign, FAILURE_END, SUCCESS_END } from "../types";

// Beginner dungeon crawl. Linear, three scenes, all combat-positive
// — built to teach a new DM the rhythm of "narrate → encounter →
// loot → advance" without too many branches. The chief's signet at
// the end ties the warren to a larger lord, leaving a thread an AI
// or human DM can pull on for a sequel.
export const GOBLIN_WARRENS: Campaign = {
  id: "goblin-warrens",
  title: "The Goblin Warrens",
  premise:
    "A merchant caravan was raided on the King's Road. The trail leads to a warren of goblin tunnels under an old quarry.",
  dmBriefing:
    "The goblins are paid scouts working for a hobgoblin warlord two valleys over. Their chief, Grask, wears a signet ring marked with the warlord's sigil — a clue meant to seed a longer arc but optional to surface. Treasure inside the warren is the merchant's: 200gp, three minor weapons, and a healing potion. No tricks, no twists. Combat-heavy on purpose; lean into ambushes and morale breaks.",
  recommendedLevel: [1, 3],
  difficulty: "low",
  tone: "pulp-action",
  npcs: [
    {
      id: "npc:grask",
      name: "Grask the Maimed",
      role: "enemy",
      appearance:
        "A wiry goblin in too-large boiled leather, missing his left ear. A heavy iron signet ring hangs on a cord at his neck.",
      personality:
        "Cowardly when alone, swaggering when his pack is at his back. Hates being made to look foolish in front of his lieutenants.",
      motivation:
        "Earn the warlord's favor by holding this warren. He'd flee in a heartbeat if it meant survival, but he can't afford to look weak.",
      voice: "Grask snarls and bites off his words. Calls humans 'longshanks'.",
    },
    {
      id: "npc:caravan-master",
      name: "Berran the Wagoner",
      role: "patron",
      appearance:
        "Heavy-built man, gray beard, a bandaged shoulder he favors. Wears the green sash of the merchants' guild.",
      personality:
        "Direct and stoic. Doesn't waste words. Will tip well for fast work.",
      motivation:
        "Recover his caravan's strongbox. Vengeance is secondary; he's mostly worried about making payroll.",
    },
  ],
  scenes: [
    {
      id: "scene:approach",
      title: "The Quarry's Edge",
      dmBackground:
        "The party arrives at the old quarry at dusk. Two goblin sentries are bored and bickering on a low rock outcrop, watching the wrong direction. A successful quiet approach (or any kind of distraction) means the party gets a free first strike. Loud arrivals trigger the encounter with the goblins shouting an alarm into the cave mouth — which causes the next scene's encounter to be reinforced.",
      readAloud: [
        "The road bends downhill into a scarred bowl of stone — an abandoned quarry, half-flooded and half-collapsed. A trail of broken wagon spokes and dropped sacks of grain leads toward a dark cave mouth at the far end. The light is going.",
        "Two figures slouch on a rocky outcrop above the cave, passing a clay jug back and forth. Goblins. Their voices carry across the still air, arguing about who has to take first watch tonight.",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "goblin",
            count: 2,
            trigger: "Sentries spot the party, or party reveals themselves.",
            intent: "Skirmish from above. The first to fall flees to alert the warren.",
          },
        ],
        notes: [
          "If the party kills both quietly, the warren is unprepared next scene — drop the goblin count there by one.",
          "If a sentry escapes or shouts, add a +1 reinforcement to the warren scene.",
        ],
      },
      transitions: [
        {
          to: "scene:warren",
          when: "Both sentries are dead, fled, or no longer a threat.",
        },
      ],
    },
    {
      id: "scene:warren",
      title: "The Lower Warren",
      dmBackground:
        "The main cavern. A cooking fire in the center, sleeping pallets along the walls, and tunnels branching off in three directions. Three goblins are here normally; reduce or add one based on the approach scene. The merchant's strongbox is here, half-pried-open, but Grask has the key on him in the next scene. The two side tunnels are dead ends (one is a midden, one is a flooded sump) — note this to discourage long detours.",
      readAloud: [
        "The cave opens into a smoky cavern. A fire crackles in a stone pit at the center, throwing wet shadows on the walls. Heaped pallets, a half-butchered deer hanging from a beam, and — at the back — a heavy iron-bound strongbox, pried at but not opened.",
        "Goblins look up from their bowls. A pause. Then a shriek, and they scramble for crude spears.",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "goblin",
            count: 3,
            trigger: "On entry. Adjust count up or down based on the approach scene.",
            intent: "Brawl. They fight to the last only if Grask is still alive; once one is down, the others may break.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 150, note: "Clearing the warren." },
          {
            kind: "potion",
            baseId: "potion-of-healing",
            note: "Stashed under a sleeping pallet.",
          },
        ],
        notes: [
          "The strongbox is locked. The key is on Grask. Players might try to force it open — let them, with effort.",
          "The two side tunnels are dead ends; if the party investigates, narrate the smell and let them turn back without a roll.",
        ],
      },
      transitions: [
        {
          to: "scene:chief",
          when: "The warren is cleared and the party pushes deeper.",
        },
      ],
    },
    {
      id: "scene:chief",
      title: "Grask's Den",
      dmBackground:
        "Grask is in his back chamber, on a 'throne' of stacked crates. He has two bodyguards (also goblins). He'll bluster, then bargain (offering the signet ring, the key, anything) the moment a bodyguard falls. If he surrenders, the players choose mercy or not — either ending is valid. Either way the signet ring is the recoverable lore artifact.",
      readAloud: [
        "The tunnel ends in a wider chamber, lit by a single guttering torch. A goblin in mismatched armor sprawls on a stack of crates, two heavier-built bodyguards at his shoulders. He grins at you, all teeth.",
        "'Longshanks,' he spits. 'You came a long way for a few sacks of grain.' He fingers a heavy iron ring at his throat. 'Maybe we make a deal.'",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "goblin",
            count: 3,
            trigger: "Combat begins, or Grask refuses to deal.",
            intent: "Boss-style confrontation. Grask flees if reduced below half HP.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 250, note: "Defeating or routing Grask." },
          {
            kind: "weapon",
            baseId: "shortsword",
            bonus: 1,
            note: "Grask's blade, simple but well-kept. A small thread of the warlord's sigil is etched near the hilt.",
          },
          {
            kind: "story",
            description:
              "The iron signet ring on a cord. Marked with a sigil the players don't recognize — a hand grasping a star.",
          },
        ],
        notes: [
          "If Grask is captured alive, he'll talk — name the warlord, the next valley, anything. A clear hook for a follow-up.",
          "The strongbox key is on Grask's belt. Give it to whoever loots him.",
        ],
      },
      transitions: [
        {
          to: SUCCESS_END,
          when: "Grask is dead, captured, or routed and the party recovers the strongbox key.",
        },
        {
          to: FAILURE_END,
          when: "The party retreats, surrenders, or falls.",
        },
      ],
    },
  ],
  conclusion: {
    success:
      "By the time you climb back out into the open air, the moon is up. The merchant's strongbox is at your feet, and Grask's signet ring — that strange grasping-hand sigil — turns slowly on its cord in your hand. Berran the Wagoner will pay you well. But that ring is going to keep turning up.",
    failure:
      "The warren swallows the last of the torchlight behind you as you stumble out, leaving the strongbox where it fell. The merchants' caravan is lost. Somewhere deeper in the quarry, a goblin chief laughs.",
  },
};
