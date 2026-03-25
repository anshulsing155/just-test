<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade, fly, scale } from 'svelte/transition';
	import { assistantConfig } from '$lib/config/assistant';
	import { assistantState, assistantActions } from '$lib/stores/assistantStore';

	// Props
	export let botName = assistantConfig.name;

	// Local state
	let userInput = '';
	let recognition;
	let chatContainer;

	// Get state from store
	$: isOpen = $assistantState.isOpen;
	$: messages = $assistantState.messages;
	$: isListening = $assistantState.isListening;
	$: isBotTyping = $assistantState.isBotTyping;
	$: currentStep = $assistantState.currentStep;

	// Auto-scroll to bottom when messages change
	$: if (messages.length > 0 || isBotTyping) {
		scrollToBottom();
	}

	async function scrollToBottom() {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTo({
				top: chatContainer.scrollHeight,
				behavior: 'smooth'
			});
		}
	}

	onMount(() => {
		const onKeyDown = (event) => {
			if (event.key === 'Escape' && isOpen) assistantActions.close();
		};
		window.addEventListener('keydown', onKeyDown);

		// Initialize speech recognition
		if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
			const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
			recognition = new SpeechRecognition();
			recognition.continuous = false;
			recognition.interimResults = false;

			recognition.onresult = (event) => {
				const transcript = event.results[0][0].transcript;
				userInput = transcript;
				handleSendMessage();
				assistantActions.setListening(false);
			};

			recognition.onerror = () => {
				assistantActions.setListening(false);
			};
		}

		// Initial greeting
		if (messages.length === 0) {
			setTimeout(() => {
				assistantActions.addMessage({
					sender: 'bot',
					text: `Hello! I'm ${botName}. How can I help you today?`
				});
				assistantActions.setStep('ask_name');
				setTimeout(() => {
					assistantActions.addMessage({
						sender: 'bot',
						text: "May I start by asking your name?"
					});
				}, 1000);
			}, 500);
		}

		return () => window.removeEventListener('keydown', onKeyDown);
	});

	onDestroy(() => {
		if (recognition && isListening) {
			try {
				recognition.stop();
			} catch {}
		}
	});

	async function handleSendMessage() {
		if (!userInput.trim()) return;
		const text = userInput;
		userInput = '';
		await assistantActions.processMessage(text);
	}

	function toggleListening() {
		if (!recognition) return;
		if (isListening) {
			recognition.stop();
			assistantActions.setListening(false);
		} else {
			recognition.start();
			assistantActions.setListening(true);
		}
	}

	function useSuggestion(suggestion) {
		userInput = suggestion;
		handleSendMessage();
	}

	function formatTime(date) {
		return new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: 'numeric',
			hour12: true
		}).format(date);
	}
</script>

<div class="fixed right-6 bottom-6 z-50 font-sans">
	<!-- Assistant toggle button (FAB) -->
	<button
		class="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2"
		on:click={assistantActions.toggleOpen}
		aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
		style="background-color: {assistantConfig.theme.primary};"
	>
		{#if isOpen}
			<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
			</svg>
		{:else}
			<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
			</svg>
		{/if}
	</button>

	<!-- Assistant panel -->
	{#if isOpen}
		<div
			class="absolute right-0 bottom-20 flex h-[550px] w-[380px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-all duration-300 sm:w-[420px]"
			transition:fly={{ y: 20, duration: 300, opacity: 0 }}
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between p-4 text-white"
				style="background-color: {assistantConfig.theme.primary};"
			>
				<div class="flex items-center space-x-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
						<svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
						</svg>
					</div>
					<div>
						<h3 class="text-lg font-semibold leading-tight">{botName}</h3>
						<p class="text-xs text-white/80">Online | Virtual Assistant</p>
					</div>
				</div>
				<div class="flex space-x-2">
					<button 
						on:click={() => assistantActions.reset()}
						class="rounded-lg p-1.5 hover:bg-white/10"
						title="Reset Conversation"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
						</svg>
					</button>
					<button on:click={assistantActions.close} class="rounded-lg p-1.5 hover:bg-white/10">
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>
				</div>
			</div>

			<!-- Messages -->
			<div
				bind:this={chatContainer}
				class="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 scrollbar-thin scrollbar-thumb-slate-200"
			>
				{#each messages as message (message.id)}
					<div class="flex {message.sender === 'user' ? 'justify-end' : 'justify-start'}" in:fade={{ duration: 200 }}>
						<div class="flex max-w-[85%] flex-col {message.sender === 'user' ? 'items-end' : 'items-start'}">
							<div
								class="rounded-2xl px-4 py-2.5 text-sm shadow-sm {message.sender === 'user' 
									? 'rounded-br-none bg-indigo-600 text-white' 
									: 'rounded-bl-none bg-white text-slate-800 border border-slate-100'}"
							>
								{message.text}
							</div>
							<span class="mt-1 text-[10px] text-slate-400">
								{formatTime(message.timestamp)}
							</span>
						</div>
					</div>
				{/each}

				{#if isBotTyping}
					<div class="flex justify-start" in:fade>
						<div class="flex flex-col items-start">
							<div class="rounded-2xl rounded-bl-none border border-slate-100 bg-white px-4 py-3 shadow-sm">
								<div class="flex space-x-1">
									<div class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style="animation-delay: 0ms"></div>
									<div class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style="animation-delay: 150ms"></div>
									<div class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style="animation-delay: 300ms"></div>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Suggestions -->
			{#if assistantConfig.suggestions && assistantConfig.suggestions.length > 0 && currentStep === 'chat'}
				<div class="flex flex-wrap gap-2 border-t border-slate-100 bg-white p-3">
					{#each assistantConfig.suggestions as suggestion}
						<button
							on:click={() => useSuggestion(suggestion)}
							class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
						>
							{suggestion}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Input area -->
			<div class="border-t border-slate-100 bg-white p-4">
				<div class="flex items-center space-x-2 rounded-xl bg-slate-100 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500/20">
					<input
						type="text"
						bind:value={userInput}
						placeholder="Type your message..."
						class="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
						on:keydown={(e) => e.key === 'Enter' && handleSendMessage()}
					/>
					
					<button
						on:click={toggleListening}
						class="rounded-full p-1.5 transition-colors {isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'}"
						aria-label={isListening ? 'Stop listening' : 'Start listening'}
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 0 1-14 0m14 0a7 7 0 0 0-14 0m14 0v4m0 0H5m14 0a7 7 0 0 1-14 0m14 0v4m0 0H5" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18v3m0 0h.01M7 21h10M12 11a3 3 0 01-3-3V5a3 3 0 116 0v3a3 3 0 01-3 3z" />
						</svg>
					</button>

					<button
						on:click={handleSendMessage}
						disabled={!userInput.trim()}
						class="rounded-full p-1.5 transition-all {userInput.trim() ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-300'}"
						aria-label="Send message"
					>
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
						</svg>
					</button>
				</div>
				<p class="mt-2 text-center text-[10px] text-slate-400">
					Powered by SvelteKit & OpenAI
				</p>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Custom scrollbar for better look */
	.scrollbar-thin::-webkit-scrollbar {
		width: 4px;
	}
	.scrollbar-thin::-webkit-scrollbar-track {
		background: transparent;
	}
	.scrollbar-thin::-webkit-scrollbar-thumb {
		background: #e2e8f0;
		border-radius: 10px;
	}
</style>
