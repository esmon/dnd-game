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
      // The sentries are the only obstacle here — winning moves the
      // party straight into the warren, no manual "press on" needed.
      advanceOnVictory: "scene:warren",
      playerActions: [
        {
          id: "sneak",
          label: "Sneak closer along the scree",
          icon: "footprints",
          response:
            "You pick your way through the loose stone, soft-footed. The goblins are still arguing — they don't see you. You're within a stone's throw, and they have their backs half-turned.",
        },
        {
          id: "charge",
          label: "Charge the outcrop, weapons drawn",
          icon: "sword",
          response:
            "You break from cover and sprint. One of the goblins shrieks, drops the jug, claws for a spear. The other is already cocking a sling. They're fighting now.",
          effect: { kind: "encounter", monsterIndex: "goblin", count: 2 },
        },
        {
          id: "hail",
          label: "Call out — offer to talk",
          icon: "talk",
          response:
            "You raise your hands and shout that you've come to talk. The goblins freeze, then laugh. The bigger one spits down the slope. The smaller one is already reaching for his sling. So much for talking.",
          effect: { kind: "encounter", monsterIndex: "goblin", count: 2 },
        },
        {
          id: "throw-rock",
          label: "Throw a rock into the brush to distract them",
          icon: "eye",
          response:
            "You scoop a stone and lob it into the brush downhill. The goblins both turn, peering. You've bought yourself a clean opening — whatever you do next, you do first.",
        },
        {
          id: "slip-past",
          label: "Slip past the sentries entirely",
          response:
            "You move like water around stone. The goblins never look up. You're past the outcrop and into the cave mouth before either of them takes the next swig from the jug — leaving them to argue all night about a watch nobody bothered to keep.",
          classes: ["rogue"],
          effect: { kind: "advance", to: "scene:warren" },
        },
        {
          id: "wait",
          label: "Wait and watch",
          icon: "wait",
          repeatable: true,
          response:
            "You settle into cover. The goblins drink, argue, drink. The light fails. After a while one of them yawns hugely and slides down to nap; the other settles in to whittle a stick. Their guard, what little there was, is gone.",
        },
        {
          id: "advance-fight",
          label: "Attack now (they spot you)",
          icon: "sword",
          response:
            "You commit. The goblins are on their feet before you've fully drawn — but only just.",
          effect: { kind: "encounter", monsterIndex: "goblin", count: 2 },
        },
        {
          id: "advance-to-warren",
          label: "Press on to the cave mouth",
          icon: "advance",
          response:
            "With the slope quiet behind you, you slip past the outcrop and the cave swallows the last of the light.",
          effect: { kind: "advance", to: "scene:warren" },
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
      playerActions: [
        {
          id: "engage",
          label: "Engage the goblins",
          icon: "sword",
          response:
            "Their first spear comes whistling past your ear before you've finished the thought. The cooking fire spits sparks as the fight starts.",
          effect: { kind: "encounter", monsterIndex: "goblin", count: 3 },
        },
        {
          id: "strongbox",
          label: "Search the strongbox",
          icon: "search",
          response:
            "The iron-bound chest is half pried open but stubbornly locked. Whatever's inside, the goblins haven't reached it yet. The key must be on someone deeper in.",
        },
        {
          id: "examine-runes",
          label: "Read the markings on the strongbox",
          response:
            "Beneath the dust, scratches on the iron band aren't goblin work — they're old merchant cant. A house mark you almost recognize: Berran's caravan was carrying for a noble. Whoever's pulling these goblins' strings knew exactly what was on board.",
          classes: ["wizard", "warlock", "bard"],
        },
        {
          id: "pick-lock",
          label: "Pick the strongbox lock",
          response:
            "You work the pin with practiced patience. It's a heavy lock but a stupid one — three tumblers, no false sets. The clasp turns. Inside: ledger pages, a pouch of coin, and — wedged at the bottom — a small velvet bag with the merchants' guild seal. You don't need Grask's key after all.",
          classes: ["rogue"],
        },
        {
          id: "side-tunnels",
          label: "Investigate the side tunnels",
          icon: "search",
          response:
            "The first tunnel reeks of midden and old refuse. The second slopes down into a foul, stagnant sump. Both are dead ends. You back out into the cavern.",
        },
        {
          id: "search-pallets",
          label: "Search the sleeping pallets",
          icon: "search",
          response:
            "Beneath one of the heaped pallets you find a small clay vial — a healing potion, stoppered with wax. You pocket it.",
        },
        {
          id: "press-deeper",
          label: "Press deeper into the warren",
          icon: "advance",
          response:
            "The far tunnel narrows and runs straight back into the rock. A faint torchlight glow from the end. Whoever's in charge is in there.",
          effect: { kind: "advance", to: "scene:chief" },
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
      playerActions: [
        {
          id: "fight",
          label: "Refuse the deal — attack",
          icon: "sword",
          response:
            "Grask's grin curdles. 'Bad answer, longshanks.' The bodyguards move first, snarling. The torchlight gutters.",
          effect: { kind: "encounter", monsterIndex: "goblin", count: 3 },
        },
        {
          id: "bargain",
          label: "Hear his offer",
          icon: "talk",
          hideAfterVictory: true,
          response:
            "Grask leans forward, eager. 'Ring. Key. Whatever you want. You walk out, we walk out, no longshanks die today.' He's lying about something — but maybe not the ring. The bodyguards haven't relaxed.",
        },
        {
          id: "intimidate",
          label: "Intimidate — \"Hand over the ring\"",
          icon: "intimidate",
          hideAfterVictory: true,
          response:
            "You take a step in. The bigger bodyguard's knuckles go white on his cleaver. Grask's eyes flicker — once to his goons, once to the back of the cave where there isn't actually a back door. He weighs it. Then his hand goes to the cord at his neck.",
        },
        {
          id: "menace",
          label: "Loom — you fill the chamber",
          hideAfterVictory: true,
          response:
            "You don't move. You don't draw. You just *grow* in the small chamber, somehow, the torchlight finding the wrong angles on your face. One bodyguard takes a step back without meaning to. Grask says nothing for a long beat. Then, quietly: 'Take the ring. Take the key. Go.'",
          classes: ["barbarian", "fighter", "paladin"],
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "pickpocket",
          label: "Pick Grask's pocket while he gestures",
          hideAfterVictory: true,
          response:
            "He's all hands and teeth, jabbing his finger at the air while he monologues. You lean a little, reach a little, and the strongbox key is in your palm before he's finished his next sentence. The bodyguards never blink. Grask never knows.",
          classes: ["rogue"],
        },
        {
          id: "true-name",
          label: "Speak the name on the signet ring aloud",
          hideAfterVictory: true,
          response:
            "The two syllables echo wrong in the torchlight. Grask flinches like you'd swung at him. The bodyguards exchange a look that says: *he never said that name to us*. The grin is gone. 'Where did you hear that,' Grask asks. He's no longer in charge of this conversation.",
          classes: ["wizard", "warlock", "cleric"],
        },
        {
          id: "demand-ring",
          label: "Take the ring and key, accept the parley",
          icon: "give",
          hideAfterVictory: true,
          response:
            "Grask snaps the cord and tosses you the iron ring. The key follows from his belt. 'Go,' he says, voice ragged. 'And never come back.' His bodyguards lower their cleavers a hair's breadth.",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "victory",
          label: "Claim the ring and leave",
          icon: "trophy",
          requiresVictory: true,
          response:
            "You search Grask's body. The iron signet on its cord. The strongbox key. The shortsword at his belt — well-kept, with a strange sigil etched near the hilt. The warren is silent.",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "retreat",
          label: "Retreat — this is too much",
          icon: "retreat",
          hideAfterVictory: true,
          response:
            "You back out of the chamber. Grask's laughter follows you down the tunnel. The strongbox sits where the goblins left it, untouched.",
          effect: { kind: "advance", to: FAILURE_END },
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
