export const assistantConfig = {
	// Basic settings
	name: 'SvelteBot',
	useApi: false,

	// Appearance
	theme: {
		primary: '#4a6cf7',
		secondary: '#f1f1f1',
		text: '#333333',
		textLight: '#ffffff'
	},

	// Features
	features: {
		voiceInput: true,
		animations: true,
		suggestions: true
	},

	// Predefined responses
	responses: {
		greeting: "Hello! I'm here to help. What can I do for you?",
		farewell: 'Goodbye! Feel free to chat again if you need assistance.',
		fallback: "I'm not sure how to help with that yet. Could you try asking something else?",
		error: 'Sorry, I encountered an error processing your request.'
	},

	// Suggested queries to show to the user
	suggestions: [
		'Show UP RERA agents',
		'How do I search an agent?',
		'What is RERA?',
		'Help me choose a loan'
	]
};
