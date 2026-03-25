import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createOtp } from '$lib/server/services/auth.service.js';

export async function POST({ request }) {
	try {
		const { mobileNumber } = await request.json();

		if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
			return json({ success: false, error: 'Invalid mobile number' }, { status: 400 });
		}

		// Generate OTP and store in DB
		const { otp, user } = await createOtp(mobileNumber);

		// Send OTP via MSG91 in production
		const authKey = env.MSG91_AUTH_KEY;
		const templateId = env.MSG91_TEMPLATE_ID;

		if (authKey && templateId) {
			const response = await fetch('https://api.msg91.com/api/v5/otp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					authkey: authKey
				},
				body: JSON.stringify({
					template_id: templateId,
					mobile: `91${mobileNumber}`,
					otp
				})
			});

			const data = await response.json();
			if (data.type !== 'success') {
				console.error('[OTP] MSG91 send failed:', data);
				// Still return success since OTP is in DB — user can retry
			}
		} else {
			// Dev mode: log OTP to console
			console.log(`[OTP] Dev mode — OTP for ${mobileNumber}: ${otp}`);
		}

		return json({ success: true, message: 'OTP sent successfully' });
	} catch (error) {
		console.error('[OTP] Error sending OTP:', error);
		return json({ success: false, error: 'Failed to send OTP' }, { status: 500 });
	}
}
