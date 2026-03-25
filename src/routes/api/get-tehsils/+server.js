export async function POST({ request }) {
	const formData = await request.formData();
	const dcode = formData.get('dcode');

	try {
		const response = await fetch('http://rera.mp.gov.in/ajax-function.php', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				dcode,
				action: 'get_tehsils'
			})
		});

		if (!response.ok) {
			throw new Error('Failed to fetch tehsils');
		}

		const tehsils = await response.text();
		return new Response(tehsils, { status: 200 });
	} catch (error) {
		return new Response(JSON.stringify({ error: error.message }), { status: 500 });
	}
}
