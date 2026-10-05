import { BlockList, isIPv4 } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/**
 * G-11: кому верить в X-Forwarded-For / X-Forwarded-Proto. Раньше —
 * `trustProxy: true`, то есть любому: Caddy заголовок от клиента
 * перезаписывает, но запрос мимо Caddy (порт app на хосте, а если его
 * когда-нибудь откроют — то и снаружи) подставлял любой IP. Лимиты для
 * анонимов считаются по IP — новый адрес в заголовке давал новый счётчик.
 *
 * Теперь верим только соседям app по docker-сети (там Caddy), кроме шлюза
 * сети: через шлюз приходит всё, что идёт на опубликованный порт с хоста
 * (вебхук LiveKit, ручной curl, docker-proxy). Адреса сети берутся из
 * интерфейсов контейнера — Caddy можно пересоздать с другим IP.
 * TRUSTED_PROXIES (список IP/CIDR через запятую) — явная замена, если прокси
 * стоит иначе.
 */
export type TrustProxyFn = (address: string, hop: number) => boolean;

function normalize(address: string): string {
  return address.startsWith("::ffff:") && isIPv4(address.slice(7)) ? address.slice(7) : address;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");
}

/** Список IP/CIDR из TRUSTED_PROXIES. */
export function trustFromList(list: string): TrustProxyFn {
  const blocks = new BlockList();
  for (const raw of list.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [address, prefix] = raw.split("/");
    const type = isIPv4(address!) ? "ipv4" : "ipv6";
    if (prefix) blocks.addSubnet(address!, Number(prefix), type);
    else blocks.addAddress(address!, type);
  }
  return (address) => {
    const ip = normalize(address);
    return blocks.check(ip, isIPv4(ip) ? "ipv4" : "ipv6");
  };
}

/** Соседи по IPv4-сетям контейнера, кроме первого адреса сети (шлюз docker). */
export function trustSiblings(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): TrustProxyFn {
  const blocks = new BlockList();
  const gateways = new Set<string>();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || !info.cidr) continue;
      const prefix = Number(info.cidr.split("/")[1]);
      // /31 и /32 — точка-точка, «соседей» нет.
      if (prefix > 30) continue;
      const size = 2 ** (32 - prefix);
      const network = Math.floor(ipv4ToInt(info.address) / size) * size;
      blocks.addSubnet(intToIpv4(network), prefix, "ipv4");
      gateways.add(intToIpv4(network + 1));
      // Свой адрес: запрос сам к себе через сеть контейнера заголовкам не доверяет.
      gateways.add(info.address);
    }
  }
  return (address) => {
    const ip = normalize(address);
    return isIPv4(ip) && !gateways.has(ip) && blocks.check(ip, "ipv4");
  };
}

export function resolveTrustProxy(trustedProxies: string | undefined): TrustProxyFn {
  return trustedProxies ? trustFromList(trustedProxies) : trustSiblings();
}
