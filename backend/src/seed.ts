import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Reading players.md...");
  const fileContent = await Bun.file("../players.md").text();
  const playerNames = fileContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (playerNames.length === 0) {
    console.error("Error: No player names found in players.md");
    process.exit(1);
  }

  console.log(`Found ${playerNames.length} players in players.md`);

  console.log("Cleaning up database...");
  await prisma.bidLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.captain.deleteMany();
  await prisma.auction.deleteMany();

  const positions = ["GK", "DEF", "MID", "FWD"];

  console.log("Seeding players with base price 40 Riyal Coins...");
  for (let i = 0; i < playerNames.length; i++) {
    const name = playerNames[i];
    // Rotate positions GK, DEF, MID, FWD
    const position = positions[i % positions.length];

    await prisma.player.create({
      data: {
        name,
        position,
        basePrice: 40,
        status: "available",
        passCount: 0
      }
    });
  }

  console.log("Database seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
