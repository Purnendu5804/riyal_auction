-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "soldPrice" INTEGER,
    "soldToCaptainId" TEXT,
    CONSTRAINT "Player_soldToCaptainId_fkey" FOREIGN KEY ("soldToCaptainId") REFERENCES "Captain" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Captain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "balance" INTEGER NOT NULL,
    "sessionToken" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPlayerId" TEXT,
    "currentHighestBid" INTEGER NOT NULL DEFAULT 0,
    "currentHighestBidderId" TEXT,
    "playerQueue" TEXT NOT NULL DEFAULT '[]'
);

-- CreateTable
CREATE TABLE "BidLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auctionId" TEXT NOT NULL,
    "captainId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Captain_sessionToken_key" ON "Captain"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_roomCode_key" ON "Auction"("roomCode");
