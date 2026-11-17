-- Avviso all'utente quando il suo comune cambia per fusione o incorporazione
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "comuneChangedFrom" TEXT;
