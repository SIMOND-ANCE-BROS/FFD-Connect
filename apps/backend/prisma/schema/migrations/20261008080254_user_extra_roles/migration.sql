-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraRoles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
