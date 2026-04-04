export type DialogueMood = "calm" | "urgent" | "grim" | "hopeful" | "defiant";

export interface DialogueLine {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  portraitId?: string;
  mood?: DialogueMood;
}

export type MissionObjectiveKind = "defeat" | "hold" | "escort" | "secure" | "survive" | (string & {});
export type MissionObjectiveGate = "start" | "mid" | "end";

export interface MissionObjective {
  id: string;
  description: string;
  kind: MissionObjectiveKind;
  gate?: MissionObjectiveGate;
  optional?: boolean;
  targetCount?: number;
  unlocksObjectiveIds?: string[];
}
