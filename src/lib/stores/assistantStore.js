import { writable, get } from 'svelte/store';

// Initial state for the assistant
const initialState = {
	isOpen: false,
	messages: [],
	isListening: false,
	isBotTyping: false,
	user: {
		name: null,
		mobile: null,
		isVerified: false
	},
	currentStep: 'greeting', // greeting, ask_name, ask_mobile, verify_otp, help_menu, chat
	sessionId: typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
	otp: null
};

// Create a store for the assistant state
export const assistantState = writable(initialState);

// Create actions to update the state
export const assistantActions = {
	open: () => {
		assistantState.update((state) => ({
			...state,
			isOpen: true
		}));
	},

	close: () => {
		assistantState.update((state) => ({
			...state,
			isOpen: false,
			isListening: false,
			isBotTyping: false
		}));
	},

	toggleOpen: () => {
		assistantState.update((state) => ({
			...state,
			isOpen: !state.isOpen
		}));
	},

	addMessage: (message) => {
		assistantState.update((state) => ({
			...state,
			messages: [
				...state.messages,
				{
					...message,
					id: typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2),
					timestamp: new Date()
				}
			]
		}));
	},

	setTyping: (isTyping) => {
		assistantState.update((state) => ({
			...state,
			isBotTyping: isTyping
		}));
	},

	setListening: (isListening) => {
		assistantState.update((state) => ({
			...state,
			isListening
		}));
	},

	updateUser: (userData) => {
		assistantState.update((state) => ({
			...state,
			user: { ...state.user, ...userData }
		}));
	},

	setStep: (step) => {
		assistantState.update((state) => ({
			...state,
			currentStep: step
		}));
	},

	clearMessages: () => {
		assistantState.update((state) => ({
			...state,
			messages: []
		}));
	},

	reset: () => {
		assistantState.set({
			...initialState,
			sessionId: typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(2)
		});
	},

	// Advanced logic for conversation flow
	processMessage: async (text) => {
		const state = get(assistantState);
		const { currentStep, user } = state;

		assistantActions.addMessage({ sender: 'user', text });
		assistantActions.setTyping(true);

		// Simulate thinking delay
		await new Promise((resolve) => setTimeout(resolve, 800));

		let botResponse = '';
		let nextStep = currentStep;

		switch (currentStep) {
			case 'greeting':
			case 'ask_name':
				if (text.length < 2) {
					botResponse = "That's a bit short for a name. Could you please tell me your full name?";
					nextStep = 'ask_name';
				} else {
					assistantActions.updateUser({ name: text });
					botResponse = `Nice to meet you, ${text}! To provide personalized assistance, could you share your mobile number?`;
					nextStep = 'ask_mobile';
				}
				break;

			case 'ask_mobile':
				const mobileRegex = /^[6-9]\d{9}$/;
				if (mobileRegex.test(text.replace(/\s/g, ''))) {
					assistantActions.updateUser({ mobile: text });
					// Generate a dummy OTP
					const otp = Math.floor(1000 + Math.random() * 9000).toString();
					assistantState.update((s) => ({ ...s, otp }));
					botResponse = `Thanks! I've sent a 4-digit verification code to ${text}. (Hint: ${otp})`;
					nextStep = 'verify_otp';
				} else {
					botResponse = 'Please enter a valid 10-digit mobile number.';
					nextStep = 'ask_mobile';
				}
				break;

			case 'verify_otp':
				if (text === state.otp) {
					assistantActions.updateUser({ isVerified: true });
					botResponse =
						'Verification successful! How can I help you today? You can ask about RERA agents, loan products, or general information.';
					nextStep = 'chat';
				} else {
					botResponse = "That code doesn't seem right. Please try again or type 'resend'.";
					if (text.toLowerCase() === 'resend') {
						const otp = Math.floor(1000 + Math.random() * 9000).toString();
						assistantState.update((s) => ({ ...s, otp }));
						botResponse = `New code sent! (Hint: ${otp})`;
					}
					nextStep = 'verify_otp';
				}
				break;

			case 'chat':
			default:
				// Call the API for complex queries
				try {
					const response = await fetch('/api/assistant', {
						method: 'POST',
						body: JSON.stringify({ query: text, sessionId: state.sessionId }),
						headers: { 'Content-Type': 'application/json' }
					});

					if (response.ok) {
						const data = await response.json();
						botResponse = data.response;
					} else {
						botResponse = "I'm having a bit of trouble connecting to my brain. Could you try again?";
					}
				} catch (e) {
					botResponse = "I'm sorry, I'm experiencing some technical difficulties. Let's try again later.";
				}
				nextStep = 'chat';
				break;
		}

		assistantActions.addMessage({ sender: 'bot', text: botResponse });
		assistantActions.setStep(nextStep);
		assistantActions.setTyping(false);
	}
};
