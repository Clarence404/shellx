import { describe, it, expect } from "vitest";
import { sshCommand, localAddress, type TunnelCommandInput } from "./tunnelCommand";

function input(over: Partial<TunnelCommandInput> = {}): TunnelCommandInput {
  return {
    bindAll: false, localPort: 15432,
    remoteHost: "db.internal", remotePort: 5432,
    username: "ec2-user", host: "bastion.example.com", port: 22,
    ...over,
  };
}

/** The view's own import parser, as a check that what we emit comes back. */
function parseSSHImport(cmd: string) {
  const re = /-L\s+(?:([^:\s]+):)?(\d+):([^:\s]+):(\d+)/g;
  const out: Array<{ local_port: number; remote_host: string; remote_port: number; bind_all: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    out.push({
      local_port: parseInt(m[2], 10), remote_host: m[3],
      remote_port: parseInt(m[4], 10), bind_all: m[1] === "0.0.0.0",
    });
  }
  return out;
}

describe("localAddress", () => {
  it("names the loopback address a local-only rule listens on", () => {
    expect(localAddress({ bindAll: false, localPort: 15432 })).toBe("127.0.0.1:15432");
  });

  it("names all interfaces when the rule binds them", () => {
    expect(localAddress({ bindAll: true, localPort: 15432 })).toBe("0.0.0.0:15432");
  });
});

describe("sshCommand", () => {
  it("forwards and nothing else", () => {
    expect(sshCommand(input())).toBe("ssh -N -L 15432:db.internal:5432 ec2-user@bastion.example.com");
  });

  it("spells out the bind address only when the rule binds every interface", () => {
    expect(sshCommand(input({ bindAll: true })))
      .toBe("ssh -N -L 0.0.0.0:15432:db.internal:5432 ec2-user@bastion.example.com");
  });

  it("leaves out -p for the default SSH port", () => {
    expect(sshCommand(input({ port: 22 }))).not.toContain("-p");
  });

  it("names a non-default SSH port", () => {
    expect(sshCommand(input({ port: 2222 })))
      .toBe("ssh -N -L 15432:db.internal:5432 -p 2222 ec2-user@bastion.example.com");
  });

  it("treats a missing port as the default rather than emitting -p 0", () => {
    expect(sshCommand(input({ port: 0 }))).not.toContain("-p");
  });

  it("names the host's key, so ssh does not fall back to ~/.ssh", () => {
    expect(sshCommand(input({ keyPath: "/home/me/.ssh/prod_ed25519" })))
      .toBe("ssh -N -L 15432:db.internal:5432 -i /home/me/.ssh/prod_ed25519 ec2-user@bastion.example.com");
  });

  it("quotes a key path with spaces in it", () => {
    const key = String.raw`C:\Users\First Last\.ssh\id_rsa`;
    expect(sshCommand(input({ keyPath: key }))).toContain(`-i "${key}"`);
  });

  it("leaves a key path without spaces unquoted", () => {
    const key = String.raw`C:\keys\id_rsa`;
    expect(sshCommand(input({ keyPath: key }))).toContain(`-i ${key}`);
    expect(sshCommand(input({ keyPath: key }))).not.toContain('"');
  });

  it("says nothing about keys for password auth", () => {
    expect(sshCommand(input({ keyPath: null }))).not.toContain("-i");
    expect(sshCommand(input({ keyPath: "   " }))).not.toContain("-i");
    expect(sshCommand(input())).not.toContain("-i");
  });

  it("puts -i after -p, before the destination", () => {
    expect(sshCommand(input({ port: 2222, keyPath: "/k" })))
      .toBe("ssh -N -L 15432:db.internal:5432 -p 2222 -i /k ec2-user@bastion.example.com");
  });

  it("carries a long remote hostname through intact", () => {
    const host = "acucloud-test-db.chu0q20em0u2.rds.cn-northwest-1.amazonaws.com.cn";
    expect(sshCommand(input({ remoteHost: host }))).toContain(`:${host}:`);
  });
});

describe("what it emits, the Tunnels view can import back", () => {
  it("round-trips a loopback rule", () => {
    const i = input();
    expect(parseSSHImport(sshCommand(i))).toEqual([
      { local_port: 15432, remote_host: "db.internal", remote_port: 5432, bind_all: false },
    ]);
  });

  it("round-trips a rule bound to every interface", () => {
    const i = input({ bindAll: true, localPort: 16379, remoteHost: "cache.internal", remotePort: 6379 });
    expect(parseSSHImport(sshCommand(i))).toEqual([
      { local_port: 16379, remote_host: "cache.internal", remote_port: 6379, bind_all: true },
    ]);
  });

  it("round-trips when a non-default port pushes -p between the parts", () => {
    const i = input({ port: 2222, bindAll: true });
    expect(parseSSHImport(sshCommand(i))[0].bind_all).toBe(true);
  });
});
