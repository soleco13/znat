import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { NetworkInterfaceInfo } from "node:os";
import { resolveTrustProxy, trustFromList, trustSiblings, type TrustProxyFn } from "./trust-proxy.js";

// Интерфейсы контейнера app на стенде: docker-сеть 172.19.0.0/16, app = .4, Caddy = .5, шлюз = .1.
const containerInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: "127.0.0.1/8" }],
  eth0: [{ address: "172.19.0.4", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: "172.19.0.4/16" }],
};

async function ipSeen(trust: TrustProxyFn, remoteAddress: string, headers: Record<string, string>) {
  const app = Fastify({ trustProxy: trust });
  app.get("/", async (request) => ({ ip: request.ip, protocol: request.protocol }));
  const res = await app.inject({ method: "GET", url: "/", remoteAddress, headers });
  await app.close();
  return res.json() as { ip: string; protocol: string };
}

describe("G-11: доверие X-Forwarded-*", () => {
  const trust = trustSiblings(containerInterfaces);
  const spoof = { "x-forwarded-for": "6.6.6.6", "x-forwarded-proto": "https" };

  it("запрос через Caddy (сосед по сети): IP и протокол клиента из заголовков", async () => {
    expect(await ipSeen(trust, "172.19.0.5", { "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https" })).toEqual({
      ip: "203.0.113.7",
      protocol: "https",
    });
  });

  it("мимо Caddy через опубликованный порт (шлюз docker): заголовок не подменяет IP", async () => {
    expect((await ipSeen(trust, "172.19.0.1", spoof)).ip).toBe("172.19.0.1");
  });

  it("порт app открыт наружу: внешний клиент не подменяет IP и протокол", async () => {
    expect(await ipSeen(trust, "198.51.100.9", spoof)).toEqual({ ip: "198.51.100.9", protocol: "http" });
  });

  it("loopback и IPv4-mapped адреса", async () => {
    expect((await ipSeen(trust, "127.0.0.1", spoof)).ip).toBe("127.0.0.1");
    expect(trust("::ffff:172.19.0.5", 0)).toBe(true);
    expect(trust("::ffff:172.19.0.1", 0)).toBe(false);
  });

  it("цепочка от клиента с подделанным XFF через Caddy: Caddy перезаписывает, но и дописанный слева адрес не выбирается мимо Caddy", async () => {
    // Если прокси дописал бы, а не перезаписал: «6.6.6.6, <реальный>» — берётся первый недоверенный справа.
    expect((await ipSeen(trust, "172.19.0.5", { "x-forwarded-for": "6.6.6.6, 203.0.113.7" })).ip).toBe("203.0.113.7");
  });

  it("TRUSTED_PROXIES: явный список заменяет вычисленный", async () => {
    const listed = trustFromList("10.0.0.2, 192.168.5.0/24");
    expect(listed("10.0.0.2", 0)).toBe(true);
    expect(listed("192.168.5.77", 0)).toBe(true);
    expect(listed("172.19.0.5", 0)).toBe(false);
    expect(resolveTrustProxy("10.0.0.2")("10.0.0.2", 0)).toBe(true);
  });
});
