-- Colleghi preferiti e avviso unico per i loro nuovi viaggi.
-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "favoritesNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Favorite" (
    "userId" UUID NOT NULL,
    "favoriteUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","favoriteUserId")
);

-- CreateIndex
CREATE INDEX "Favorite_favoriteUserId_idx" ON "Favorite"("favoriteUserId");

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_favoriteUserId_fkey" FOREIGN KEY ("favoriteUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
