export interface ExportProgress {
  status: 'pending' | 'processing' | 'done' | 'error';
  total: number;
  completed: number;
  message: string;
  label: string;
  userId: string;
}
