export type Background = {
  id: string;
  name: string;
  description: string;
};

export const BACKGROUNDS: readonly Background[] = [
  {
    id: "acolyte",
    name: "Acolyte",
    description: "You have spent your life in the service of a temple to a specific god or pantheon.",
  },
  {
    id: "charlatan",
    name: "Charlatan",
    description: "You have a flair for the dramatic and an instinct for separating fools from their coin.",
  },
  {
    id: "criminal",
    name: "Criminal",
    description: "You are an experienced criminal with a history of breaking the law and contacts in the underworld.",
  },
  {
    id: "entertainer",
    name: "Entertainer",
    description: "You thrive in front of an audience, captivating them with stories, music, or daring feats.",
  },
  {
    id: "folk-hero",
    name: "Folk Hero",
    description: "You come from a humble social rank but are destined for so much more, championing the common people.",
  },
  {
    id: "guild-artisan",
    name: "Guild Artisan",
    description: "You are a member of an artisan's guild, skilled in a particular field and respected by your fellows.",
  },
  {
    id: "hermit",
    name: "Hermit",
    description: "You lived in seclusion for a formative part of your life, gaining insight unavailable to others.",
  },
  {
    id: "noble",
    name: "Noble",
    description: "You understand wealth, power, and privilege, and bear a title that opens doors others cannot.",
  },
  {
    id: "outlander",
    name: "Outlander",
    description: "You grew up in the wilds, far from civilization and its comforts.",
  },
  {
    id: "sage",
    name: "Sage",
    description: "You spent years learning the lore of the multiverse from books and mentors.",
  },
  {
    id: "sailor",
    name: "Sailor",
    description: "You sailed on a seagoing vessel for years, weathering storms and fighting off pirates.",
  },
  {
    id: "soldier",
    name: "Soldier",
    description: "War has been your life for as long as you care to remember, and discipline runs in your blood.",
  },
  {
    id: "urchin",
    name: "Urchin",
    description: "You grew up on the streets, alone and hungry, learning to survive by your wits.",
  },
];
