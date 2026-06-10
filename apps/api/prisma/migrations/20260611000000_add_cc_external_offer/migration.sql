-- CreateTable
CREATE TABLE "CcExternalOffer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "recipientParty" TEXT NOT NULL,
    "recipientLabel" TEXT NOT NULL,
    "amountCc" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CcExternalOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CcExternalOffer_contractId_key" ON "CcExternalOffer"("contractId");

-- AddForeignKey
ALTER TABLE "CcExternalOffer" ADD CONSTRAINT "CcExternalOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;