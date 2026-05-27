import { type Campaign, FAILURE_END, SUCCESS_END } from "../types";

// Three-scene high-level finale. Approach → lair → dragon. The
// twist is structural rather than narrative: the dragon isn't where
// the rumor said. Players have to either negotiate with a hostile
// pseudodragon courier OR push deeper through a cave hazard scene.
// Designed to feel earned — there's a real boss fight at the end,
// not "and now the dragon talks".
export const WYRMS_HOLLOW: Campaign = {
  id: "wyrms-hollow",
  title: "The Wyrm's Hollow",
  premise:
    "The shepherds in the high valleys speak of a red shadow on the cliffs at dusk. The lords pay well for a confirmed sighting. They pay better for proof of a kill.",
  dmBriefing:
    "The shadow is real — an adult red dragon named Vyrkalith. She has roosted in the highest cave of the Hollow for three years, mostly sleeping, occasionally raiding herds. The cave the locals point to is the LOWER cave — Vyrkalith's kobold servants live there, watching the road. The real lair is two miles up and around, through a sulfur-vent passage the kobolds won't enter. The party can fight their way through the kobolds OR persuade the lead kobold (Klick) to show them the upper path in exchange for a promise of mercy. Either way they end the campaign face to face with an adult red dragon. This is a boss-shaped campaign — no shortcuts past the climax, but lots of choice in how to get there.",
  recommendedLevel: [7, 10],
  difficulty: "high",
  tone: "high-fantasy",
  npcs: [
    {
      id: "npc:vyrkalith",
      name: "Vyrkalith",
      role: "enemy",
      appearance:
        "An adult red dragon, sixty feet from snout to tail-tip. Her scales are the color of a cooling forge. One eye is glass-white — old wound, never properly healed.",
      personality:
        "Patient. Arrogant. Curious. Will speak to the party at length before deciding how to kill them. Genuinely respects boldness; loathes cowering.",
      motivation:
        "Sleep, hunt, accumulate. She isn't conquering anything. She likes this valley and has no intention of leaving.",
      voice:
        "Deep, slow, amused. Calls the party 'small ones'. Quotes back what they say to her.",
    },
    {
      id: "npc:klick",
      name: "Klick of the Lower Cave",
      role: "neutral",
      appearance:
        "A wiry kobold with a charred patch on her chest scales and a notched obsidian dagger at her belt.",
      personality:
        "Pragmatic. Frightened of Vyrkalith but proud of her position. Open to deals if the offer is real.",
      motivation:
        "Survive. Her clan has been slowly dying serving the dragon. She'd take an honest exit if one were offered.",
      voice:
        "Quick, lisping, third-person. 'Klick sees you. Klick is not stupid.'",
    },
  ],
  scenes: [
    {
      id: "scene:approach",
      title: "The Lower Cave",
      dmBackground:
        "A high-altitude valley, sulfur in the air, last of the sheep tracks petering out before a narrow cave mouth. Eight kobolds inside, but they're guards, not warriors — they'll fight if attacked, but Klick (their lead) will negotiate if the party leads with talk. The cave has firetail bones, a half-eaten goat, and a crude tally-stick marking days since the last raid (47). Klick knows the upper path exists; she's never been more than fifty feet into the sulfur tunnel. She'll trade the route for the party's promise to leave her clan alone after the dragon falls. (If Vyrkalith dies, Klick's clan becomes free for the first time in three years — but the party doesn't have to know that.) Combat path: straight brawl against the kobolds. Diplomatic path: a single tense conversation with Klick and her two lieutenants present.",
      readAloud: [
        "The valley narrows. The air tastes wrong — sulfur on the tongue, the kind that catches in your throat. Above you, at the head of a scree slope, a cave mouth stares down like an eye. Bones glitter at its edges.",
        "Kobolds. Six visible, more in the shadow. They've seen you. They aren't running. The one in front has a charred patch on her chest and a black-glass dagger.",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "kobold",
            count: 8,
            trigger: "The party attacks, or refuses to negotiate with Klick.",
            intent:
              "Guarded skirmish. Klick uses the cave's narrow chokepoints — she'll fall back if the party flanks her.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 300, note: "Clearing or negotiating the lower cave." },
          {
            kind: "story",
            description:
              "Knowledge of the upper path through the sulfur vent. The only way to Vyrkalith.",
          },
          {
            kind: "potion",
            baseId: "greater-healing",
            note: "Hidden in Klick's bedroll. The party finds it whether she lives or dies.",
          },
        ],
        notes: [
          "Klick's tell: she'll deal if the party shows any restraint. The first violent gesture closes the door.",
          "If diplomacy works, give the party a +2 on initiative in the dragon scene — Klick gives them a heads up on what to expect.",
        ],
      },
      transitions: [
        {
          to: "scene:vent",
          when: "The party has the route to the upper lair (combat or diplomacy).",
        },
      ],
      playerActions: [
        {
          id: "hail-klick",
          label: "Lead with talk — hail the kobolds",
          icon: "talk",
          response:
            "You raise an open hand and call up the scree. The lead kobold tilts her head. 'Klick sees you. Klick is not stupid.' The black-glass dagger stays at her belt — for now. She's listening. That's more than most would give you.",
        },
        {
          id: "offer-deal",
          label: "Offer Klick's clan mercy for the upper path",
          icon: "talk",
          response:
            "'You want the high cave.' Klick's lisp drops to almost nothing. 'The burning one's cave.' You promise her clan their lives once the dragon falls. A long pause. Then she scratches a route into the dirt with her dagger — up, around, through the sulfur vent her people won't enter. 'Klick remembers a promise. See that you do too.'",
          effect: { kind: "advance", to: "scene:vent" },
        },
        {
          id: "attack-kobolds",
          label: "Attack the cave mouth",
          icon: "sword",
          response:
            "The first violent gesture closes the door for good. Klick barks a word and the kobolds break for the chokepoints, slings already spinning. The cave fills with the rattle of stone and the hiss of firetail venom.",
          effect: { kind: "encounter", monsterIndex: "kobold", count: 8 },
        },
        {
          id: "read-cave",
          label: "Read the cave for what the kobolds guard",
          icon: "search",
          response:
            "Firetail bones, a half-eaten goat, a tally-stick notched forty-seven times — days since the last raid. These aren't warriors; they're a starving clan keeping watch on a road. And the sulfur tunnel at the back, the one even they won't go near, breathes warm air down from somewhere far above.",
        },
        {
          id: "scout-route",
          label: "Scout the sulfur tunnel yourself",
          icon: "footprints",
          classes: ["rogue", "ranger"],
          response:
            "You slip wide of the kobolds and put your head into the back tunnel. The heat hits first, then the stink. But the draft is unmistakable — it climbs, and it carries the faint, far-off smell of woodsmoke that isn't woodsmoke. This is the way up.",
          effect: { kind: "advance", to: "scene:vent" },
        },
        {
          id: "enter-tunnel",
          label: "Take the sulfur tunnel up",
          icon: "advance",
          response:
            "The lower cave behind you, you face the narrow black throat of the sulfur vent. The kobolds wouldn't follow even if they could. The heat rolls down to meet you, and you start to climb.",
          effect: { kind: "advance", to: "scene:vent" },
        },
      ],
    },
    {
      id: "scene:vent",
      title: "The Sulfur Vent",
      dmBackground:
        "A two-mile climb through a narrow lava tube. This is a hazard scene, not a combat scene. The air is poisonous in stretches — anyone without a way to breathe filtered air takes ongoing damage every few minutes of travel (mechanic: one CON save each ten minutes; failure = 1d6 poison damage, success = nothing). The party can find an outflow vent halfway up and rest there. They emerge onto a high stone ledge above the dragon's lair. This is where they should hear Vyrkalith for the first time — humming to herself in a low, deep voice as she sorts her hoard. The hum is the warning. The scene exists to remind the players that they are in over their heads before they choose to keep going.",
      readAloud: [
        "The passage is narrower than your shoulders in places. The air shimmers. Your lantern flame burns yellow, then green, then yellow again. Somewhere up ahead, the rock is warm to the touch.",
        "Two hours up, you emerge onto a ledge that overlooks a cavern so large your light dies before it finds the far wall. And in that dark, something is humming. Slowly. To itself. In a language you don't speak. The hum stops. Then starts again, an octave lower.",
      ],
      scripted: {
        notes: [
          "CON save: DC 13. Failure: 1d6 poison damage. Success: no effect. Don't roll for every tick — once at the start of the climb, once at the midpoint, once near the top.",
          "The outflow vent rest stop is a freebie if the party looks for it. Reward exploration here, don't punish caution.",
          "Don't let the players go back. The kobolds (if alive) won't let them through twice. If they retreat, narrate the dragon hearing them and stirring — bring her down to scene 1 if you want the campaign to end early.",
        ],
        rewards: [{ kind: "xp", amount: 200, note: "Surviving the climb." }],
      },
      transitions: [
        {
          to: "scene:lair",
          when: "The party reaches the upper ledge and chooses to descend.",
        },
        {
          to: FAILURE_END,
          when: "The party retreats and the dragon comes hunting for them.",
        },
      ],
      playerActions: [
        {
          id: "press-climb",
          label: "Press on up the vent",
          icon: "footprints",
          repeatable: true,
          response:
            "You climb. The passage narrows past your shoulders; the rock turns warm, then hot. Your lantern flame burns yellow, green, yellow. The air bites at your lungs — hold your breath through the bad stretches and keep moving, because stopping here is worse.",
        },
        {
          id: "find-vent",
          label: "Look for a place to rest",
          icon: "search",
          response:
            "Halfway up, you find it: an outflow vent where clean cold air pours in through a crack in the rock. You can breathe here. You can bind wounds and steady your hands before the last of the climb. Take the moment. You will want it.",
        },
        {
          id: "listen-hum",
          label: "Listen to the dark ahead",
          icon: "eye",
          response:
            "From the ledge above, where your light dies before it finds a far wall, something is humming. Slowly. To itself. In a language you don't speak. The hum stops — as if it heard you think about it — then starts again, an octave lower. You are, you understand now, badly out of your depth.",
        },
        {
          id: "descend-lair",
          label: "Descend to the lair",
          icon: "advance",
          response:
            "You climb down off the ledge toward the humming, toward the cold glitter of gold at the edge of the dark. There is no quiet way to do this. There was never going to be.",
          effect: { kind: "advance", to: "scene:lair" },
        },
        {
          id: "retreat-vent",
          label: "Turn back",
          icon: "retreat",
          response:
            "You decide the high valley can keep its red shadow. But the hum behind you changes pitch — rises, sharpens, *wakes* — and the rock at your back begins to warm. Something vast has heard you leaving, and it is coming down the mountain to see you off.",
          effect: { kind: "advance", to: FAILURE_END },
        },
      ],
    },
    {
      id: "scene:lair",
      title: "Vyrkalith",
      dmBackground:
        "The boss fight. Vyrkalith greets the party first — she has heard them coming for an hour. She offers conversation. She offers a deal (one of them, in exchange for the rest leaving). She mocks. Then she fights. Combat starts when the party makes the first hostile move OR refuses any deal three times. The lair is a vaulted cave full of crusted gold, charred bones, and the wreckage of caravans she's eaten. Optional: a single chest in the back holds a flame-tongue sword (mark as `longsword +2`) and 1500gp. Vyrkalith is balanced for the recommended level as a single-monster fight — assume the standard adult red dragon stat block. If the party negotiates a truce instead (she'll accept if they offer her something genuinely interesting), the campaign succeeds without the kill. Both endings count.",
      readAloud: [
        "The cave opens out into a vault of stone the size of a cathedral. Cold gold glitters underfoot. And on the gold, watching you with one good eye and one milk-white one, is a dragon the color of a cooling forge.",
        "'Small ones,' she says. The word is a yawn. 'You climbed all that way. Talk to me a moment, before I decide what to do with you.'",
      ],
      scripted: {
        encounters: [
          {
            monsterIndex: "adult-red-dragon",
            trigger: "Combat begins (player aggression or refused negotiation).",
            intent: "Boss fight. She fights smart — full breath weapon on grouped parties, frightful presence on the highest-AC fighter.",
          },
        ],
        rewards: [
          { kind: "xp", amount: 1500, note: "Defeating or coming to terms with Vyrkalith." },
          {
            kind: "weapon",
            baseId: "longsword",
            bonus: 2,
            note: "Flame-Tongue. Hums faintly. Hot to the touch.",
          },
          {
            kind: "armor",
            baseId: "plate",
            bonus: 1,
            note: "An ornate breastplate of forge-red enamel, from a centuries-old paladin Vyrkalith ate.",
          },
          {
            kind: "story",
            description:
              "1500 gold in mixed coin from across the centuries. Some of it is from kingdoms that no longer exist.",
          },
        ],
        notes: [
          "Vyrkalith respects boldness. Players who match her at conversation get more material to work with — she'll volunteer history, lore, the names of past visitors.",
          "Deal-making path: she'll accept (a) one of the party as her servant, (b) a famous artifact, (c) a binding promise to leave the valley alone for a generation. Players choose how heavy a price to pay.",
          "If the dragon falls, the kobolds (if Klick is alive) take the news quietly and leave the valley. Hook for a follow-up.",
        ],
      },
      transitions: [
        {
          to: SUCCESS_END,
          when: "Vyrkalith is dead, or the party leaves with a binding truce.",
        },
        {
          to: FAILURE_END,
          when: "The party falls, flees, or accepts servitude.",
        },
      ],
      playerActions: [
        {
          id: "hear-dragon",
          label: "Hear what the dragon has to say",
          icon: "talk",
          response:
            "'Small ones.' The word is a yawn that stirs the cold gold underfoot. 'You climbed all that way.' Vyrkalith watches you with one good eye and one of milk-white glass. 'Three years I have had this valley, and no one has bothered to climb so high to die. Tell me why I shouldn't be impressed. Or insulted.'",
        },
        {
          id: "match-wits",
          label: "Match her, word for word",
          icon: "talk",
          response:
            "You meet the amusement in her voice and give it back. Something shifts in the great head — interest, maybe. She quotes your own words back to you, savoring them, and volunteers a name or two of those who came before you. She respects boldness. You have just bought yourself the only currency that matters here.",
        },
        {
          id: "loot-hoard",
          label: "Eye the chest at the back of the hoard",
          icon: "search",
          response:
            "Half-buried in cold coin at the back of the vault: a single iron chest. Through the gap in its lid you catch the red gleam of an enameled breastplate and the faint, hot hum of a sword that has not been cold in a hundred years. Getting to it means turning your back on a dragon. Choose your moment.",
        },
        {
          id: "offer-truce",
          label: "Offer Vyrkalith a price to leave the valley",
          icon: "give",
          response:
            "You name a price worth her while — a binding oath, a famous blade, a promise heavy enough to bend a dragon's pride. Vyrkalith is quiet for a long, long moment. Then, slowly, she lowers that vast head. 'Done, small one. You are the first in three years worth a bargain. Go. Before I reconsider the novelty.'",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "fight-dragon",
          label: "Strike at the dragon",
          icon: "sword",
          response:
            "'Ah,' she says, almost pleased, as the first blow leaves your hand. 'You chose the loud way.' Vyrkalith rises off her hoard like a furnace door swinging open, wings cracking the dark, and the cavern fills with the smell of a forge about to vent.",
          effect: { kind: "encounter", monsterIndex: "adult-red-dragon" },
        },
        {
          id: "claim-kill",
          label: "Stand over the fallen dragon",
          icon: "trophy",
          response:
            "Vyrkalith's last breath leaves her like a forge going cold, and the hum that haunted the valley for three years finally stops. The hoard is yours to pick through; the proof the lords wanted is undeniable. You came all this way, and the red shadow is gone.",
          effect: { kind: "advance", to: SUCCESS_END },
        },
        {
          id: "accept-servitude",
          label: "Trade one of your own for the rest",
          icon: "retreat",
          response:
            "She offers the old bargain: one of you stays, and the rest walk free. When you take it, her laugh is the worst part — low, satisfied, certain. The valley keeps its red shadow, and keeps one of you besides. The survivors descend in silence.",
          effect: { kind: "advance", to: FAILURE_END },
        },
      ],
    },
  ],
  conclusion: {
    success:
      "The wind off the high valley smells, for the first time in three years, of nothing but cold air and stone. Behind you, in the dark of the upper cave, the hum has stopped. The lords will want proof. You have it.",
    failure:
      "Smoke rises from the high valley for a week after. Whatever was in the Hollow is no longer in the Hollow. The lords double the bounty. They will not find anyone foolish enough to take it again.",
  },
};
