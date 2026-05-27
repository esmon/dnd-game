import { type Campaign, FAILURE_END, SUCCESS_END } from "../types";

// Mid-tier gothic mystery. Slower opening than Goblin Warrens —
// scene 1 is investigation-heavy with one optional combat, so the
// DM gets practice running social / exploration beats. The twist is
// signposted in the dmBriefing so the human DM can drop clues at
// their pace; the AI version gets the same context and can dial up
// the eeriness as the party gets closer.
export const HAUNTED_MANOR: Campaign = {
  id: "haunted-manor",
  title: "The Haunted Manor",
  premise:
    "A village beyond the moor has stopped sending its tribute. The last messenger came back gibbering about a manor on a hill that should not be there.",
  dmBriefing:
    "Forty years ago, Lady Mireille Vassard bound her dying daughter's soul to the manor to save her. The binding worked, after a fashion — Anelise has been wandering the halls ever since, and the manor has stopped aging around her. Mireille is long dead (her bones are in the cellar) but her wards still hold. The way to end the haunting is to bring Anelise her mother's locket from the cellar; she's been searching for it for forty years and can't enter the cellar because Mireille's wards keep her out. The wraith in scene 2 is *not* Anelise — it's a former servant the manor consumed. Anelise is gentle, lonely, and won't attack unless cornered. The party can solve the campaign without combat in scene 3 if they think to give her the locket.",
  recommendedLevel: [3, 5],
  difficulty: "mid",
  tone: "gothic-horror",
  npcs: [
    {
      id: "npc:anelise",
      name: "Anelise Vassard",
      role: "neutral",
      appearance:
        "A pale girl of about twelve, in a faded blue dress that looks fifty years out of fashion. She doesn't quite touch the floor when she walks.",
      personality:
        "Soft-spoken, polite, lonely. Echoes phrases her mother used to say. Goes very still when frightened.",
      motivation:
        "Find her mother's locket. She doesn't know her mother is dead. She wants to go home, but doesn't realize she already is home.",
      voice:
        "Old-fashioned, half-whispered. Calls strangers 'sir' and 'miss'. Hums a lullaby when she thinks no one is listening.",
    },
    {
      id: "npc:village-elder",
      name: "Granny Falsom",
      role: "patron",
      appearance:
        "A wiry old woman with a cane carved from a goat's horn. Sharp eyes.",
      personality:
        "Suspicious of outsiders, but desperate. Speaks in hedge-witch metaphors.",
      motivation:
        "Save what's left of her village. Knows more than she lets on about the Vassard line.",
    },
    {
      id: "npc:caleb",
      name: "Caleb the Forgotten",
      role: "enemy",
      appearance:
        "A wraith in tattered footman's livery, his face an outline that won't resolve no matter how long you stare.",
      personality:
        "Spite and resentment. Speaks only in fragments: orders he was given, names he was told to remember.",
      motivation:
        "Drag any living thing it finds into the manor's hunger. He doesn't remember his own name.",
    },
  ],
  scenes: [
    {
      id: "scene:village",
      title: "The Last House on the Moor",
      dmBackground:
        "The village has fifteen people left. Granny Falsom is the only one who'll speak openly. She tells the players the manor 'returned' three weeks ago — it was burned down forty years past and now stands again. She knew the Vassards; she knows Mireille was the witch. She does NOT know what happened to the daughter (this is the players' to discover). She gives the party an iron-tipped charm; explain it doesn't 'do' anything mechanical but the players who carry it have advantage on their next saving throw vs fear effects.",
      readAloud: [
        "The village sits at the edge of a moor that breathes in fog and breathes out silence. Smoke rises from three chimneys. The road in is rutted with old wagon-tracks, none recent.",
        "An old woman watches you from a doorway, leaning on a horn-tipped cane. 'I knew you'd come,' she says, before you've spoken. 'Two weeks I've been waiting. Sit down. The kettle's on.'",
      ],
      scripted: {
        rewards: [
          {
            kind: "story",
            description:
              "An iron-tipped charm. Advantage on the next saving throw vs fear for whoever carries it.",
          },
          { kind: "xp", amount: 100, note: "Roleplay + clue-gathering." },
        ],
        notes: [
          "Granny's three confirmable facts: (1) the manor burned forty years ago, (2) Mireille Vassard was a hedge-witch widely feared, (3) she had a daughter, name forgotten.",
          "Granny refuses to come to the manor. Don't argue.",
          "If players push for combat here, there is none — the village is empty of threat. Let them feel that.",
        ],
      },
      transitions: [
        {
          to: "scene:foyer",
          when: "The party leaves the village and reaches the manor.",
        },
      ],
      playerActions: [
        {
          id: "ask-manor",
          label: "Ask Granny about the manor",
          icon: "talk",
          response:
            "Granny pours the tea before you ask. 'Burned to the foundation, forty years gone. I watched it go up.' She blows across her cup. 'Three weeks past, it came back. Whole. Lamps in the windows.' She doesn't look at you when she says it.",
        },
        {
          id: "ask-vassards",
          label: "Ask who lived there",
          icon: "talk",
          response:
            "'Mireille Vassard. A hedge-witch — the kind folk crossed the road to avoid.' Granny's mouth thins. 'She had a daughter. Quiet little thing. I can't bring the name back, try as I might. Strange, that. I knew it once.'",
        },
        {
          id: "ask-fear",
          label: "Ask why the village won't go up there",
          icon: "talk",
          response:
            "'Because the ones who went up didn't come down,' she says simply. 'And because some nights, when the wind's right, you can hear a child laughing on that hill. A child.' She lets that sit. 'There are no children left in this village.'",
        },
        {
          id: "take-charm",
          label: "Accept Granny's iron charm",
          icon: "give",
          response:
            "She presses something cold into your palm — an iron-tipped charm on a leather thong, worn smooth. 'It won't stop what's up there,' she says. 'But it'll steady your nerve once. That may be enough. It may not.'",
        },
        {
          id: "examine-charm",
          label: "Read the old magic in the charm",
          icon: "search",
          classes: ["wizard", "cleric", "druid"],
          response:
            "You turn the charm over. The iron is bound with a hair of cold-forged silver and a word scratched too small to read. Hedge-craft — crude, genuine, and old. It will hold against fear, once, and then it will be spent.",
        },
        {
          id: "to-manor",
          label: "Set out for the manor",
          icon: "advance",
          response:
            "Granny doesn't see you to the door. The moor road climbs through fog that thickens with every step, and then the manor is simply there at the top of the hill — lamps lit in the windows, as if it had been waiting up for you.",
          effect: { kind: "advance", to: "scene:foyer" },
        },
      ],
    },
    {
      id: "scene:foyer",
      title: "Inside the Manor",
      dmBackground:
        "The manor is not in ruins. It looks as if no time has passed since 40 years ago — except dust. A great staircase rises from the foyer. Sounds carry oddly: a child's laughter from one room, then a different room. The wraith of Caleb attacks halfway through if the players linger in the dining hall (it's the place he died). If they don't go to the dining hall, the wraith reveals itself when they approach the cellar door (it's the door he was forbidden from). Either way, scene 2 = one solid combat against the wraith, balanced for the recommended level. After the wraith falls, players find a corpse in a sealed drawing room — Mireille's last servant — clutching a brass key labeled 'cellar'.",
      readAloud: [
        "The doors of the manor open before you knock. The foyer is high-ceilinged and silent, the air thick with dust. A great staircase climbs into shadow.",
        "Somewhere upstairs, a child laughs. Once. Not again. The sound came from a different room than the one it should have.",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "wraith",
            trigger:
              "The party lingers in the dining hall OR approaches the cellar door. Don't trigger it both places — once is enough.",
            intent:
              "Pure combat. The wraith does not negotiate. Caleb's spite is the only thing left of him.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 200, note: "Defeating the wraith." },
          {
            kind: "story",
            description:
              "A brass key labeled 'cellar', clutched by a long-dead servant.",
          },
          {
            kind: "scroll",
            spellBaseId: "magic-missile",
            note: "Tucked into a music box on a mantelpiece. Three uses.",
          },
        ],
        notes: [
          "The child's laughter is Anelise (introduced in scene 3) — but the players don't see her yet.",
          "Mireille's ward against Anelise is a smear of dried herbs above the cellar door. Players who examine it can sense it's old magic, still active.",
          "If the players try to leave the manor before the wraith is dealt with, the doors are now shut. The manor has noticed them.",
        ],
      },
      transitions: [
        {
          to: "scene:cellar",
          when: "The wraith is defeated and the cellar key is recovered.",
        },
      ],
      playerActions: [
        {
          id: "search-halls",
          label: "Search the halls",
          icon: "search",
          repeatable: true,
          response:
            "Dust over everything, undisturbed for decades, yet the lamps burn. A child laughs in a room upstairs — then in a room downstairs, a heartbeat later. On a mantelpiece, a music box holds a folded scroll, the ink still sharp.",
        },
        {
          id: "examine-ward",
          label: "Examine the cellar door",
          icon: "search",
          classes: ["wizard", "cleric", "druid"],
          response:
            "A smear of dried herbs is fixed above the cellar door, bound with the same hedge-craft as Granny's charm — but vast, and decades old, and still humming with intent. It was made to keep something *in* the house out of this one room.",
        },
        {
          id: "press-cellar",
          label: "Press on toward the cellar door",
          icon: "sword",
          response:
            "The temperature drops between one step and the next. The laughter stops. Out of the dark of the dining hall, a shape in tattered footman's livery resolves — a face that won't hold still no matter how you stare. Caleb has found you.",
          effect: { kind: "encounter", monsterIndex: "wraith" },
        },
        {
          id: "find-key",
          label: "Search the sealed drawing room",
          icon: "search",
          response:
            "Behind a door swollen shut you find a small dry room, and in it a long-dead servant curled around a brass key. The tag, in a steward's careful hand, reads simply: cellar. The fingers give it up reluctantly.",
        },
        {
          id: "descend-cellar",
          label: "Unlock the cellar and descend",
          icon: "advance",
          response:
            "The brass key turns with a groan of forty-year rust. The dried herbs above the door crackle and fall to powder as it swings open, and cold, wet air breathes up at you from the dark below.",
          effect: { kind: "advance", to: "scene:cellar" },
        },
      ],
    },
    {
      id: "scene:cellar",
      title: "The Cellar and the Girl",
      dmBackground:
        "The cellar has Mireille's skeleton, slumped against a workbench, the bone-hilted knife she used to bind Anelise's soul still in her ribs. A small velvet locket lies in the dust beside her — Anelise's. When the party emerges with it, Anelise is waiting at the top of the cellar stairs, having heard them coming. THIS IS THE CRITICAL BEAT: she is not hostile. If the players hand her the locket and explain (gently) what happened, she can rest, and the manor crumbles around them. If they attack her, she fights — frightened — and a successful kill releases the binding the same way, but the party loses the chance for a clean resolution. If they ignore her or try to leave with the locket, she follows them, weeping, all the way out of the manor; the binding doesn't break and the haunting persists. The campaign is winnable several ways. Lean into player agency.",
      readAloud: [
        "The cellar stairs descend into damp cold. At the bottom, in the circle of your torchlight: a workbench, a scattering of dried herbs, a skeleton in a long-rotted dress slumped against the wood. A bone-handled knife is buried in its ribs. And, near its outstretched hand — a small velvet locket on a silver chain.",
        "You climb the cellar stairs with the locket in hand. At the top, a child waits. She doesn't quite touch the floor. Her hands are folded in front of her, and her eyes are very, very tired.",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "ghost",
            trigger: "Only if the party attacks Anelise.",
            intent:
              "Reluctant. She is not trying to kill them — she is terrified and lashing out. Roleplay accordingly.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 300, note: "Resolving the haunting (any path)." },
          {
            kind: "weapon",
            baseId: "dagger",
            bonus: 2,
            note: "Mireille's bone-handled binding knife. Awarded if the players think to take it.",
          },
          {
            kind: "story",
            description:
              "The locket — silver, tarnished, holding a lock of pale brown hair. Open it and you can hear a faint lullaby, only for a moment.",
          },
        ],
        notes: [
          "Anelise's voice cue: she says 'Mother said I shouldn't go in the cellar.' Use it.",
          "If the party gives her the locket: she smiles, says 'thank you,' and is gone. Roll for narrative effect.",
          "If they attack her: combat is short and grim. The locket still works post-mortem.",
        ],
      },
      transitions: [
        {
          to: SUCCESS_END,
          when: "Anelise is at peace — gently or otherwise — and the locket reunited.",
        },
        {
          to: FAILURE_END,
          when: "The party flees with the locket or abandons the manor while Anelise still wanders it.",
        },
      ],
      playerActions: [
        {
          id: "take-locket",
          label: "Take the velvet locket",
          icon: "search",
          response:
            "You lift the locket from the dust beside Mireille's outstretched bones. Silver, tarnished, light as a held breath. When you thumb it open a lullaby spills out — faint, only for a moment — and then it's just a lock of pale brown hair.",
        },
        {
          id: "take-knife",
          label: "Draw the bone-handled knife",
          icon: "search",
          response:
            "You work the bone-handled knife free of the skeleton's ribs. The grip is warm, which it has no right to be. This is the blade that bound the girl; it remembers the work.",
        },
        {
          id: "speak-girl",
          label: "Speak gently to the girl",
          icon: "talk",
          response:
            "You keep your voice low. The child watches you with very tired eyes. 'Mother said I shouldn't go in the cellar,' she offers, almost apologetic. 'I've been looking such a long time. Have you seen it? My locket. Mother's locket.'",
        },
        {
          id: "give-locket",
          label: "Give Anelise the locket",
          icon: "give",
          response:
            "You hold out the locket. She takes it in both small hands, and something forty years tight finally lets go of her. 'Oh,' she breathes. 'You found it.' She smiles — really smiles — says 'thank you, miss,' and is simply not there anymore. All around you, the manor begins, gently, to come apart.",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "attack-girl",
          label: "Strike the girl down",
          icon: "sword",
          response:
            "You move on her. She flinches back, terror cracking across that small face — 'no, no, I only—' — and then the gentle thing is gone and something cornered and screaming takes its place, the air howling cold around it.",
          effect: { kind: "encounter", monsterIndex: "ghost" },
        },
        {
          id: "lay-locket",
          label: "Lay the locket where she fell",
          icon: "give",
          response:
            "It's over, and quiet. You set the locket down in the cold air where she stood. For a moment a lullaby hangs there, faint, and then the binding lets go all the same — grim, graceless, but done. The manor begins to come apart around you.",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "flee-manor",
          label: "Flee the manor with the locket",
          icon: "retreat",
          response:
            "You take the stairs two at a time, the locket clenched in your fist. She follows — weeping, calling after you, 'please, please, it's mine' — all the way to the doors and out onto the moor. Behind you the manor still stands. The binding holds. She is still in it.",
          effect: { kind: "advance", to: FAILURE_END },
        },
      ],
    },
  ],
  conclusion: {
    success:
      "You walk back across the moor in the gray light before dawn. Behind you, where the manor stood, there is only an old foundation and ash. The locket is warm in someone's pocket, and getting warmer.",
    failure:
      "You leave the manor behind, but it does not leave you. On the road back to the village, somewhere in the fog, a child is humming a lullaby. Once or twice, when you look back, you almost see her.",
  },
};
