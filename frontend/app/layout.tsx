import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riyal Football Auction — Real-Time bidding",
  description: "Bid on your favorite players using Riyal Coins in our real-time football auction platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}


