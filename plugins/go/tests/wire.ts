export function frame(body: string | object): Buffer {
  const json = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return Buffer.concat([Buffer.from("Content-Length: " + json.length + "\r\n\r\n"), json]);
}
export function splitFrame(bytes: Buffer) {
  const sep = bytes.indexOf("\r\n\r\n");
  if (sep < 0) return null;
  const length = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/i.exec(bytes.subarray(0, sep).toString());
  if (!length) throw new Error("Expected a framed test response");
  const end = sep + 4 + Number(length[1]);
  if (bytes.length < end) return null;
  return { end, message: JSON.parse(bytes.subarray(sep + 4, end).toString()) };
}
