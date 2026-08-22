CREATE TABLE `activityLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`userId` int NOT NULL,
	`action` varchar(255) NOT NULL,
	`entityType` varchar(100),
	`entityId` int,
	`changes` text,
	`ipAddress` varchar(45),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activityLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`patientId` int NOT NULL,
	`appointmentDate` datetime NOT NULL,
	`duration` int DEFAULT 30,
	`reason` text,
	`notes` text,
	`assignedDoctor` int,
	`status` enum('scheduled','confirmed','completed','cancelled','no_show') DEFAULT 'scheduled',
	`reminderSent` boolean DEFAULT false,
	`reminderSentDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`patientId` int NOT NULL,
	`visitId` int NOT NULL,
	`billNumber` varchar(50) NOT NULL,
	`consultationFee` decimal(10,2) NOT NULL,
	`labTotal` decimal(10,2) DEFAULT '0',
	`drugTotal` decimal(10,2) DEFAULT '0',
	`grandTotal` decimal(10,2) NOT NULL,
	`amountPaid` decimal(10,2) DEFAULT '0',
	`balanceAmount` decimal(10,2) NOT NULL,
	`paymentStatus` enum('unpaid','partial','paid') DEFAULT 'unpaid',
	`paymentMethod` enum('cash','mtn_momo','bank_transfer','cheque'),
	`billDate` datetime NOT NULL,
	`dueDate` datetime,
	`paidDate` datetime,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `bills_billNumber_unique` UNIQUE(`billNumber`)
);
--> statement-breakpoint
CREATE TABLE `clinics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`registrationNumber` varchar(100),
	`phone` varchar(20),
	`email` varchar(320),
	`address` text,
	`city` varchar(100),
	`country` varchar(100) DEFAULT 'Uganda',
	`consultationFee` decimal(10,2) DEFAULT '0',
	`mtnMomoNumber` varchar(20),
	`subscriptionStatus` enum('active','inactive','suspended') DEFAULT 'active',
	`subscriptionTier` enum('starter','standard','premium','enterprise') DEFAULT 'standard',
	`lastBackupDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clinics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drugStockHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`drugId` int NOT NULL,
	`transactionType` enum('add','deduct','restock','adjustment') NOT NULL,
	`quantityChanged` int NOT NULL,
	`previousQuantity` int NOT NULL,
	`newQuantity` int NOT NULL,
	`reason` text,
	`userId` int,
	`visitId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `drugStockHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drugs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`drugName` varchar(255) NOT NULL,
	`genericName` varchar(255),
	`quantity` int NOT NULL,
	`unit` varchar(50) NOT NULL,
	`costPerUnit` decimal(10,2) NOT NULL,
	`sellingPrice` decimal(10,2) NOT NULL,
	`lowStockThreshold` int NOT NULL,
	`expiryDate` date,
	`batchNumber` varchar(100),
	`supplier` varchar(255),
	`lastRestockDate` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `drugs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `labTests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitId` int NOT NULL,
	`testName` varchar(255) NOT NULL,
	`cost` decimal(10,2) NOT NULL,
	`result` text,
	`resultDate` datetime,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `labTests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`patientId` varchar(20) NOT NULL,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100),
	`dateOfBirth` date,
	`age` int,
	`gender` enum('male','female','other'),
	`phone` varchar(20),
	`email` varchar(320),
	`village` varchar(100),
	`nextOfKin` varchar(255),
	`nextOfKinPhone` varchar(20),
	`photoUrl` text,
	`medicalHistory` text,
	`allergies` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `patients_id` PRIMARY KEY(`id`),
	CONSTRAINT `patients_patientId_unique` UNIQUE(`patientId`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`billId` int NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`paymentMethod` enum('cash','mtn_momo','bank_transfer','cheque') NOT NULL,
	`paymentDate` datetime NOT NULL,
	`transactionId` varchar(100),
	`status` enum('pending','confirmed','failed') DEFAULT 'pending',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prescribedDrugs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitId` int NOT NULL,
	`drugId` int,
	`drugName` varchar(255) NOT NULL,
	`dosage` varchar(100),
	`quantity` int NOT NULL,
	`unit` varchar(50),
	`costPerUnit` decimal(10,2) NOT NULL,
	`totalCost` decimal(10,2) NOT NULL,
	`instructions` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `prescribedDrugs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `smsNotifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`recipientPhone` varchar(20) NOT NULL,
	`recipientType` enum('patient','staff','manager') NOT NULL,
	`messageType` enum('appointment_reminder','payment_receipt','low_stock_alert','visit_confirmation') NOT NULL,
	`messageContent` text NOT NULL,
	`appointmentId` int,
	`billId` int,
	`drugId` int,
	`status` enum('pending','sent','failed') DEFAULT 'pending',
	`sentDate` timestamp,
	`failureReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `smsNotifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clinicId` int NOT NULL,
	`patientId` int NOT NULL,
	`visitDate` datetime NOT NULL,
	`chiefComplaint` text,
	`clinicalNotes` text,
	`diagnosis` text,
	`consultationFee` decimal(10,2) NOT NULL,
	`doctorId` int,
	`receptionistId` int,
	`status` enum('pending','completed','cancelled') DEFAULT 'completed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `visits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('receptionist','doctor','manager','admin') NOT NULL DEFAULT 'receptionist';--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `clinicId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;