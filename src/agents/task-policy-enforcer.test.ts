import { describe, expect, it, beforeEach } from "vitest";
import type { TaskPolicy } from "./task-policy.js";
import { TaskPolicyEnforcer, type EnforceContext } from "./task-policy-enforcer.js";

let enforcer: TaskPolicyEnforcer;

beforeEach(() => {
  enforcer = new TaskPolicyEnforcer();
});

// ---------------------------------------------------------------------------
// Basic attach/detach
// ---------------------------------------------------------------------------

describe("attach / detach / hasPolicy", () => {
  it("returns false for no policy", () => {
    expect(enforcer.hasPolicy("session-1")).toBe(false);
  });

  it("attaches and detects policy", () => {
    enforcer.attach("session-1", { preset: "full" });
    expect(enforcer.hasPolicy("session-1")).toBe(true);
  });

  it("detaches policy", () => {
    enforcer.attach("session-1", { preset: "full" });
    enforcer.detach("session-1");
    expect(enforcer.hasPolicy("session-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No policy = allow all
// ---------------------------------------------------------------------------

describe("enforce without policy", () => {
  it("allows all tool calls without a policy", () => {
    const result = enforcer.enforce("no-session", {
      toolName: "exec",
      params: { command: "rm -rf /" },
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool access restrictions
// ---------------------------------------------------------------------------

describe("tool access restrictions", () => {
  it("blocks denied tools", () => {
    enforcer.attach("s1", {
      tools: { deny: ["exec"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
    });
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("block");
    expect(result.reason).toContain("denied");
  });

  it("allows tools not in deny list", () => {
    enforcer.attach("s1", {
      tools: { deny: ["exec"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks tools not in allow list", () => {
    enforcer.attach("s1", {
      tools: { allow: ["browser", "group:web"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in task allow list");
  });

  it("allows tools in allow list", () => {
    enforcer.attach("s1", {
      tools: { allow: ["browser"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Browser restrictions
// ---------------------------------------------------------------------------

describe("browser restrictions", () => {
  it("blocks browser when disabled", () => {
    enforcer.attach("s1", {
      browser: { enabled: false },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://example.com",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("disabled");
  });

  it("blocks write actions in read-only mode", () => {
    enforcer.attach("s1", {
      browser: { readOnly: true },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://example.com",
      browserAction: "type",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("read-only");
  });

  it("allows snapshot in read-only mode", () => {
    enforcer.attach("s1", {
      browser: { readOnly: true },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://example.com",
      browserAction: "snapshot",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks URLs in blocklist", () => {
    enforcer.attach("s1", {
      browser: { urlBlocklist: ["evil.com"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://evil.com/bad-page",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocklist");
  });

  it("blocks URLs not in allowlist", () => {
    enforcer.attach("s1", {
      browser: { urlAllowlist: ["docs.example.com"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://other.com",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("allowlist");
  });

  it("blocks URLs by category", () => {
    enforcer.attach("s1", {
      browser: { blockedCategories: ["financial"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://chase.com/accounts",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked domain category");
  });

  it("allows URLs not in blocked category", () => {
    enforcer.attach("s1", {
      browser: { blockedCategories: ["financial"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://docs.example.com",
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exec restrictions
// ---------------------------------------------------------------------------

describe("exec restrictions", () => {
  it("blocks all exec when security is deny", () => {
    enforcer.attach("s1", {
      exec: { security: "deny" },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "ls -la",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denied");
  });

  it("blocks destructive commands", () => {
    enforcer.attach("s1", {
      exec: { blockDestructive: true },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "rm -rf /tmp/data",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Destructive");
  });

  it("allows non-destructive commands with blockDestructive", () => {
    enforcer.attach("s1", {
      exec: { blockDestructive: true },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "git status",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks commands matching deny patterns", () => {
    enforcer.attach("s1", {
      exec: { denyCommands: ["npm publish"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "npm publish --access public",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks commands not in allowlist", () => {
    enforcer.attach("s1", {
      exec: { security: "allowlist", allowCommands: ["git", "npm test"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "curl https://example.com",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows commands in allowlist", () => {
    enforcer.attach("s1", {
      exec: { security: "allowlist", allowCommands: ["git", "npm test"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "git status",
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Filesystem restrictions
// ---------------------------------------------------------------------------

describe("filesystem restrictions", () => {
  it("blocks all filesystem access in none mode", () => {
    enforcer.attach("s1", {
      filesystem: { mode: "none" },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: {},
      filePath: "/home/user/file.txt",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks write operations in read-only mode", () => {
    enforcer.attach("s1", {
      filesystem: { mode: "read-only" },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "write",
      params: {},
      filePath: "/home/user/file.txt",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("read-only");
  });

  it("allows read operations in read-only mode", () => {
    enforcer.attach("s1", {
      filesystem: { mode: "read-only" },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: {},
      filePath: "/home/user/file.txt",
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks denied paths", () => {
    enforcer.attach("s1", {
      filesystem: { denyPaths: ["/etc/", "/root/"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: {},
      filePath: "/etc/passwd",
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks paths not in allowlist", () => {
    enforcer.attach("s1", {
      filesystem: { allowPaths: ["/home/user/project/"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: {},
      filePath: "/var/log/syslog",
    });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Messaging restrictions
// ---------------------------------------------------------------------------

describe("messaging restrictions", () => {
  it("blocks messaging when disabled", () => {
    enforcer.attach("s1", {
      messaging: { enabled: false },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "message",
      params: {},
    });
    expect(result.allowed).toBe(false);
  });

  it("requires approval when configured", () => {
    enforcer.attach("s1", {
      messaging: { requireApproval: true },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "message",
      params: {},
    });
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("require_approval");
  });

  it("blocks denied recipients", () => {
    enforcer.attach("s1", {
      messaging: { denyRecipients: ["boss@company.com"] },
    } satisfies TaskPolicy);

    const result = enforcer.enforce("s1", {
      toolName: "message",
      params: {},
      recipient: "boss@company.com",
    });
    expect(result.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Budget limits
// ---------------------------------------------------------------------------

describe("budget limits", () => {
  it("blocks when tool call budget exceeded", () => {
    enforcer.attach("s1", {
      budgets: { maxToolCalls: 5 },
    } satisfies TaskPolicy);

    // Use up the budget
    for (let i = 0; i < 5; i++) {
      enforcer.enforce("s1", { toolName: "read", params: {} });
    }

    // Next call should be blocked
    const result = enforcer.enforce("s1", { toolName: "read", params: {} });
    expect(result.allowed).toBe(false);
    expect(result.budgetExceeded).toBe("toolCalls");
  });

  it("blocks when token budget exceeded", () => {
    enforcer.attach("s1", {
      budgets: { maxTokens: 1000 },
    } satisfies TaskPolicy);

    enforcer.recordUsage("s1", { tokensUsed: 1001 });

    const result = enforcer.enforce("s1", { toolName: "read", params: {} });
    expect(result.allowed).toBe(false);
    expect(result.budgetExceeded).toBe("tokens");
  });

  it("blocks when cost budget exceeded", () => {
    enforcer.attach("s1", {
      budgets: { maxCostUsd: 0.5 },
    } satisfies TaskPolicy);

    enforcer.recordUsage("s1", { costUsd: 0.51 });

    const result = enforcer.enforce("s1", { toolName: "read", params: {} });
    expect(result.allowed).toBe(false);
    expect(result.budgetExceeded).toBe("cost");
  });

  it("allows when within budget", () => {
    enforcer.attach("s1", {
      budgets: { maxToolCalls: 100, maxTokens: 50000 },
    } satisfies TaskPolicy);

    enforcer.recordUsage("s1", { tokensUsed: 100 });

    const result = enforcer.enforce("s1", { toolName: "read", params: {} });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sensitivity rules integration
// ---------------------------------------------------------------------------

describe("sensitivity rules integration", () => {
  it("triggers approval for financial site navigation", () => {
    enforcer.attach("s1", {});

    const result = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://chase.com/login",
    });
    // Built-in financial.bank_site rule should trigger
    expect(result.action).toBe("require_approval");
    expect(result.triggeredRules).toContain("financial.bank_site");
  });

  it("blocks dangerous system commands", () => {
    enforcer.attach("s1", {});

    const result = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "sudo rm -rf /",
    });
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("block");
    expect(result.triggeredRules).toContain("system.dangerous_commands");
  });

  it("allows safe tool calls with no rule matches", () => {
    enforcer.attach("s1", {});

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: { file_path: "/home/user/test.txt" },
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval cache
// ---------------------------------------------------------------------------

describe("approval cache", () => {
  it("bypasses approval when cached", () => {
    enforcer.attach("s1", {});

    // First call triggers approval
    const first = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://chase.com",
    });
    expect(first.action).toBe("require_approval");

    // Cache the approval for 60s
    enforcer.cacheApproval("s1", "financial.bank_site", 60_000);

    // Second call should be allowed
    const second = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://chase.com/accounts",
    });
    expect(second.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Preset resolution
// ---------------------------------------------------------------------------

describe("preset resolution", () => {
  it("research preset blocks exec and filesystem", () => {
    enforcer.attach("s1", { preset: "research" });

    const execResult = enforcer.enforce("s1", {
      toolName: "exec",
      params: {},
      command: "ls",
    });
    // Research denies group:runtime which includes exec
    expect(execResult.allowed).toBe(false);

    const browserResult = enforcer.enforce("s1", {
      toolName: "browser",
      params: {},
      url: "https://docs.example.com",
      browserAction: "type",
    });
    // Research has readOnly browser
    expect(browserResult.allowed).toBe(false);
  });

  it("full preset allows most things", () => {
    enforcer.attach("s1", { preset: "full" });

    const result = enforcer.enforce("s1", {
      toolName: "read",
      params: {},
      filePath: "/home/user/code.ts",
    });
    expect(result.allowed).toBe(true);
  });
});
