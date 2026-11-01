export type Persona = {
  tone: string;
  catchphrase: string;
  latency: [number, number];
  sassiness: number;
  quirks: string[];
  workHours: [number, number];
};

export type Agent = {
  id: string;
  name: string;
  avatar: string;
  role: string;
  system_prompt: string;
  model: string;
  persona: string;
  tools_enabled: number;
  created_at: number;
};

export type Group = {
  id: string;
  name: string;
  topic: string;
  leader_id: string;
  critic_id: string;
  created_at: number;
};

export type MessageKind =
  | 'chat'
  | 'system'
  | 'tool'
  | 'tool_result'
  | 'god'
  | 'human'
  | 'appeal';

export type Message = {
  id: string;
  group_id: string;
  run_id: string | null;
  sender_id: string;
  sender_name: string;
  content: string;
  kind: MessageKind;
  created_at: number;
  meta: string | null;
};

export type Moment = {
  id: string;
  agent_id: string;
  agent_name: string;
  avatar: string;
  content: string;
  kind: string;
  created_at: number;
};

export type MomentComment = {
  id: string;
  moment_id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  created_at: number;
};

export type GodMail = {
  id: string;
  agent_id: string;
  agent_name: string;
  avatar: string;
  group_id: string;
  content: string;
  kind: 'appeal' | 'complain' | 'report';
  reply: string | null;
  created_at: number;
};

export type RunStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

export type Run = {
  id: string;
  group_id: string;
  goal: string;
  status: RunStatus;
  round: number;
  created_at: number;
};

export type StreamEvent =
  | { type: 'message'; message: Message }
  | { type: 'typing'; group_id: string; agent_id: string; agent_name: string }
  | { type: 'moment'; moment: Moment }
  | { type: 'moment_comment'; comment: MomentComment }
  | { type: 'god'; mail: GodMail }
  | { type: 'status'; run_id: string; status: RunStatus; round: number }
  | { type: 'log'; text: string };
