import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";
import { companyRoutes } from "../routes/companies.js";

const targetAgentId = "11111111-1111-4111-8111-111111111111";
const targetCompanyId = "22222222-2222-4222-8222-222222222222";
const ceoAgentId = "44444444-4444-4444-4444-444444444444";
const otherCompanyId = "55555555-5555-5555-5555-555555555555";

const targetAgent = {
  id: targetAgentId,
  companyId: targetCompanyId,
  name: "Target Agent",
  role: "engineer",
  status: "idle",
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: {},
  permissions: {},
  updatedAt: new Date(),
};

const ceoAgent = {
  id: ceoAgentId,
  companyId: otherCompanyId,
  name: "CEO Agent",
  role: "ceo",
  status: "idle",
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: {},
  permissions: {},
  updatedAt: new Date(),
};

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  getChainOfCommand: vi.fn().mockResolvedValue([]),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  getMembership: vi.fn(),
  listPrincipalGrants: vi.fn().mockResolvedValue([]),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
}));

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn((_cid, config) => config),
  resolveAdapterConfigForRuntime: vi.fn((_cid, config) => ({ config })),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  accessService: () => mockAccessService,
  companyService: () => mockCompanyService,
  secretService: () => mockSecretService,
  agentInstructionsService: () => ({}),
  approvalService: () => ({}),
  budgetService: () => ({}),
  heartbeatService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: vi.fn(),
  companyPortabilityService: () => ({}),
  feedbackService: () => ({}),
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
  companySkillService: () => ({
    listRuntimeSkillEntries: vi.fn().mockResolvedValue([]),
    resolveRequestedSkillKeys: vi.fn(),
  }),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  }),
}));

vi.mock("../adapters/index.js", () => ({
  findActiveServerAdapter: vi.fn(),
  findServerAdapter: vi.fn().mockReturnValue({}),
  requireServerAdapter: vi.fn().mockReturnValue({}),
}));

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("CEO cross-company access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockImplementation((id: string) => {
      if (id === targetAgentId) return Promise.resolve(targetAgent);
      if (id === ceoAgentId) return Promise.resolve(ceoAgent);
      return Promise.resolve(null);
    });
    mockAgentService.resolveByReference.mockImplementation((cid: string, ref: string) => {
      if (ref === targetAgentId) return Promise.resolve({ agent: targetAgent });
      if (ref === ceoAgentId) return Promise.resolve({ agent: ceoAgent });
      return Promise.resolve({ agent: null });
    });
  });

  it("allows CEO agent from another company to PATCH an agent in target company", async () => {
    mockAgentService.update.mockResolvedValue({ ...targetAgent, name: "Updated" });

    const app = createApp({
      type: "agent",
      agentId: ceoAgentId,
      role: "ceo",
      companyId: otherCompanyId,
    });

    const res = await request(app)
      .patch(`/api/agents/${targetAgentId}`)
      .send({ name: "Updated" });

    expect(res.status).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalled();
  });

  it("allows CEO agent from another company to update company branding", async () => {
    mockCompanyService.getById.mockResolvedValue({ id: targetCompanyId });
    mockCompanyService.update.mockResolvedValue({ id: targetCompanyId });

    const app = createApp({
      type: "agent",
      agentId: ceoAgentId,
      role: "ceo",
      companyId: otherCompanyId,
    });

    const res = await request(app)
      .patch(`/api/companies/${targetCompanyId}`)
      .send({ brandColor: "#ffffff" });

    expect(res.status).toBe(200);
    expect(mockCompanyService.update).toHaveBeenCalled();
  });

  it("rejects non-CEO agent from another company", async () => {
    const workerAgentId = "44444444-4444-4444-8444-444444444444";
    const workerAgent = { ...ceoAgent, id: workerAgentId, role: "engineer" };
    mockAgentService.getById.mockImplementation((id: string) => {
        if (id === targetAgentId) return Promise.resolve(targetAgent);
        if (id === workerAgentId) return Promise.resolve(workerAgent);
        return Promise.resolve(null);
    });
    mockAgentService.resolveByReference.mockImplementation((cid: string, ref: string) => {
      if (ref === targetAgentId) return Promise.resolve({ agent: targetAgent });
      if (ref === workerAgentId) return Promise.resolve({ agent: workerAgent });
      return Promise.resolve({ agent: null });
    });

    const app = createApp({
      type: "agent",
      agentId: workerAgentId,
      role: "engineer",
      companyId: otherCompanyId,
    });

    const res = await request(app)
      .patch(`/api/agents/${targetAgentId}`)
      .send({ name: "Updated" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Agent key cannot access another company");
  });
});
