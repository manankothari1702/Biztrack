export type Priority = 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Pending' | 'In Progress' | 'Completed';
export type ClientType = 'Prospect' | 'User' | 'Associate' | 'Supervisor';
export type ClientStatus = 'Active' | 'Archived' | 'Converted';

export enum OrgLevel {
  Root = 'Root',
  Supervisor = 'Supervisor',
  WorldTeam = 'World Team',
  ActiveWorldTeam = 'Active World Team',
  GET = 'GET',
  GET2500 = 'GET 2500',
  Millionaire = 'Millionaire Team',
  Mill7500 = 'Mill 7500',
  President = 'President Team',
  Chairman = 'Chairman Club',
  Founder = 'Founder Circle',
}

export interface User {
  name: string;
  email: string;
  level: OrgLevel;
  phoneNumber?: string;
  countryCode?: string;
  reportGenerationTime?: string;  // HH:MM in user's local timezone
  reportEnabled?: boolean;
  timezone?: string;              // IANA tz string e.g. "Asia/Kolkata"
  lastReportSentAt?: string;      // ISO string
  lastReportStatus?: 'delivered' | 'failed';
  photoURL?: string;
  avatarColor?: string;
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  dueDate: string; // ISO Date string
  notes: string;
}

export interface Client {
  id: string;
  clientName: string;
  clientNameLower?: string; // Normalized for search
  mobileDigits?: string;    // Normalized digits (no spaces/dashes)
  mobileReverse?: string;   // Reversed digits (for suffix search)
  profileImage?: string; // New
  company?: string;
  mobile: string;
  phoneNumber?: string; // Local part
  country?: string; // Country name
  countryCode: string; // Prefix
  email: string;
  clientType: ClientType;
  frequency: 'Daily' | 'Weekly' | 'Bi-Weekly' | 'Monthly';
  lastContactDate?: string; // ISO Date string
  nextFollowUpDate: string; // ISO Date string
  notes: string;
  status: ClientStatus;
  createdAt: string; // New ISO Date string
}

// Flat shape stored in Firestore — no children array
export interface FlatOrgNode {
  id: string;
  name: string;
  role: string;
  level: OrgLevel;
  parentId: string | null;
}

// In-memory tree shape built by buildOrgTree — never written to Firestore
export interface OrgNode extends FlatOrgNode {
  children: OrgNode[];
}
