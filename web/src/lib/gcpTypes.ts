// --- GCP data types ---

export interface GcpProject {
  projectId: string;
  name: string;
  projectNumber: string;
  lifecycleState: string;
  createTime?: string;
}

export interface BillingAccount {
  name: string;
  displayName: string;
  open: boolean;
  masterBillingAccount?: string;
  currencyCode?: string;
}

export interface BillingInfo {
  projectId: string;
  billingAccountName?: string;
  billingEnabled: boolean;
}

export interface Budget {
  name: string;
  displayName: string;
  budgetFilter?: {
    projects?: string[];
  };
  amount?: {
    specifiedAmount?: { currencyCode: string; units?: string; nanos?: number };
    lastPeriodAmount?: Record<string, never>;
  };
  thresholdRules?: { thresholdPercent: number; spendBasis: string }[];
  billingAccountId: string;
  billingAccountDisplayName?: string;
}

export interface EnabledService {
  name: string;
  config?: { title?: string; name?: string };
  state?: string;
}

export interface Resource {
  type: string;
  typeLabel: string;
  name: string;
  projectId: string;
  zone?: string;
  region?: string;
  location?: string;
  status?: string;
  state?: string;
  machineType?: string;
  tier?: string;
  databaseVersion?: string;
  runtime?: string;
  storageClass?: string;
  currentNodeCount?: number;
  url?: string;
}

export interface FirestoreDatabase {
  name: string;
  locationId: string;
  type: string;
}

export interface FirestoreEntry {
  projectId: string;
  databases: FirestoreDatabase[];
}

export interface ApiUsageEntry {
  name: string;
  title: string;
  projects: string[];
}

export interface IdleProject {
  projectId: string;
  createTime?: string;
}

export interface Issue {
  title: string;
  detail: string;
  action: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "stop_bleeding" | "prevent_overspend" | "cleanup" | "governance";
  estimatedMonthlyCost: number;
  verified: boolean;
  projectId?: string;
  consoleUrl?: string;
}

export interface DataError {
  context: string;
  message: string;
}

export interface EnrichedProject extends GcpProject {
  billingLinked: boolean;
  billingAccountName?: string;
  budgetCovered: boolean;
  budgetReason?: string;
  idle: boolean;
  enabledServiceCount: number;
  resourceCount: number;
  firestoreDatabases: FirestoreDatabase[];
}

export interface EnrichedBillingAccount extends BillingAccount {
  id: string;
  linkedProjects: { projectId: string; billingEnabled: boolean }[];
  budgets: ParsedBudget[];
}

export interface ParsedBudget {
  displayName: string;
  amount: number | null;
  currency: string;
  period: string;
  billingAccount: string;
  billingAccountDisplayName: string;
  projectNumbers: string[];
  thresholds: { percent: number }[];
}

export interface DashboardData {
  loading: boolean;
  phase: string;
  fetchedAt: number | null;
  projects: EnrichedProject[];
  billingAccounts: EnrichedBillingAccount[];
  budgets: ParsedBudget[];
  resources: Resource[];
  resourceTypeCounts: Record<string, number>;
  idleProjects: IdleProject[];
  apiUsage: ApiUsageEntry[];
  firestore: FirestoreEntry[];
  issues: Issue[];
  errors: DataError[];
  spend: SpendData;
  monitoring: MonitoringData;
  budgetCoverage: { uncoveredCount: number };
  projectNames: Record<string, string>;
  projectNumberToName: Record<string, string>;
  projectNumberToId: Record<string, string>;
}

export interface SpendResult {
  table: { projectId: string; datasetId: string; tableId: string };
  currency: string;
  totalCost: number;
  totalCredits: number;
  netCost: number;
  windowDays: number;
  byService: { service: string; cost: number; credits: number }[];
  byProject: { project_id: string; cost: number; credits: number }[];
  byDay: { day: string; cost: number; credits: number }[];
  byMonth: { month: string; cost: number; credits: number }[];
  byProjectMonth: { month: string; project_id: string; cost: number }[];
  byProjectService: { project_id: string; service: string; cost: number; credits: number }[];
}

export interface SpendData {
  loading: boolean;
  results: SpendResult[];
}

export interface MetricPoint {
  t: string;
  v: number;
}

export interface MetricSeries {
  labels: Record<string, string>;
  points: MetricPoint[];
}

export interface MonitoringData {
  loading: boolean;
  config: { key: string; label: string }[];
  /** projectId -> metricKey -> series[] */
  byProject: Record<string, Record<string, MetricSeries[]>>;
  /** metricKey -> rows sorted by total desc */
  leaderboard: Record<string, { projectId: string; total: number }[]>;
  windowHours: number;
}
