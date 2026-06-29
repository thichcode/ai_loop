export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'partial' | 'cancelled';
export type TaskStatus = 'pending' | 'running' | 'approved' | 'needs_fix' | 'failed' | 'cancelled';
export type LogStream = 'stdout' | 'stderr' | 'system';

export interface CreateJobInput {
  repoPath: string;
  request: string;
  branchName?: string;
  maxRounds: number;
  plannerModel: string;
  coderModel: string;
  reviewerModel: string;
}

export interface JobRecord extends CreateJobInput {
  id: string;
  status: JobStatus;
  phase: string;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskRecord {
  id: string;
  jobId: string;
  taskIndex: number;
  title: string;
  prompt: string;
  verifyCommand: string;
  status: TaskStatus;
  rounds: number;
  reviewerVerdict: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobLogRecord {
  id: number;
  jobId: string;
  taskId: string | null;
  phase: string;
  stream: LogStream;
  message: string;
  createdAt: string;
}

export interface JobArtifactRecord {
  id: number;
  jobId: string;
  taskId: string | null;
  name: string;
  content: string;
  createdAt: string;
}

export interface PlannedTask {
  title: string;
  prompt: string;
  verify: string;
}
