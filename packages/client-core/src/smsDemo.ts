export interface DemoSms {
  id: string;
  recipientId: string;
  maskedPhone: string;
  templateId: string;
  content: string;
  createdAt: string;
  expiresAt: string;
  mode: 'Mock';
  status: 'Simulated';
}
