import { json } from '@sveltejs/kit';
import { verifyOtp } from '$lib/server/services/auth.service.js';

export async function POST({ request }) {
	try {
		const { mobileNumber, otp } = await request.json();

		if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
			return json({ success: false, error: 'Invalid mobile number' }, { status: 400 });
		}

		if (!otp || !/^\d{6}$/.test(otp)) {
			return json({ success: false, error: 'Invalid OTP format' }, { status: 400 });
		}

		const result = await verifyOtp(mobileNumber, otp);

		if (!result.success) {
			return json({ success: false, error: result.message }, { status: 400 });
		}

		return json({
			success: true,
			message: result.message,
			user: {
				id: result.user.id,
				mobile: result.user.mobile,
				name: result.user.name,
				isVerified: result.user.isVerified
			}
		});
	} catch (error) {
		console.error('[OTP] Error verifying OTP:', error);
		return json({ success: false, error: 'Failed to verify OTP' }, { status: 500 });
	}
}
