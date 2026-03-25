import { prisma } from '../db.js';

const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 3;

/**
 * Generate a random 6-digit OTP
 */
export function generateOtp() {
	return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Create or find user by mobile, generate OTP and store in DB.
 * @param {string} mobile - 10-digit mobile number
 * @returns {{ otp: string, user: object }}
 */
export async function createOtp(mobile) {
	// Upsert user
	const user = await prisma.user.upsert({
		where: { mobile },
		update: {},
		create: { mobile }
	});

	const otp = generateOtp();
	const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

	// Invalidate any previous unused OTPs for this mobile
	await prisma.otpVerification.updateMany({
		where: { mobile, verified: false },
		data: { verified: true } // mark old ones as used
	});

	// Create fresh OTP record
	const otpRecord = await prisma.otpVerification.create({
		data: {
			mobile,
			otp,
			expiresAt,
			userId: user.id
		}
	});

	return { otp, otpId: otpRecord.id, user };
}

/**
 * Verify an OTP for a mobile number.
 * @param {string} mobile - 10-digit mobile number
 * @param {string} otp - 6-digit OTP
 * @returns {{ success: boolean, message: string, user?: object }}
 */
export async function verifyOtp(mobile, otp) {
	const record = await prisma.otpVerification.findFirst({
		where: {
			mobile,
			otp,
			verified: false,
			expiresAt: { gt: new Date() }
		},
		orderBy: { createdAt: 'desc' }
	});

	if (!record) {
		// Check if OTP exists but expired
		const expired = await prisma.otpVerification.findFirst({
			where: { mobile, otp, verified: false }
		});
		if (expired) {
			return { success: false, message: 'OTP has expired. Please request a new one.' };
		}
		return { success: false, message: 'Invalid OTP.' };
	}

	// Check max attempts
	if (record.attempts >= MAX_OTP_ATTEMPTS) {
		return { success: false, message: 'Too many attempts. Please request a new OTP.' };
	}

	// Increment attempts
	await prisma.otpVerification.update({
		where: { id: record.id },
		data: { attempts: { increment: 1 } }
	});

	// Mark as verified
	await prisma.otpVerification.update({
		where: { id: record.id },
		data: { verified: true }
	});

	// Mark user as verified + update last login
	const user = await prisma.user.update({
		where: { mobile },
		data: { isVerified: true, lastLoginAt: new Date() }
	});

	return { success: true, message: 'OTP verified successfully.', user };
}

/**
 * Get user by mobile
 */
export async function getUserByMobile(mobile) {
	return prisma.user.findUnique({ where: { mobile } });
}
