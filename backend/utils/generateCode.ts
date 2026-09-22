export function generateCode(): string {
  let outString = "";
  let inOptions: string = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 6; i++) {
    outString += inOptions.at(Math.floor(Math.random() * inOptions.length));
  }

  return outString;
}
