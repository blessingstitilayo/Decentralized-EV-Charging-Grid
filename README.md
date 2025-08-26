# 🔋 Decentralized EV Charging Grid

Welcome to a revolutionary decentralized platform for electric vehicle (EV) charging! This project creates a borderless grid where EV owners can discover, reserve, and pay for charging stations using tokenized energy units on the Stacks blockchain. By tokenizing kilowatt-hours (kWh) as fungible tokens, it solves real-world problems like fragmented charging infrastructure, cross-border payment hassles, currency conversion fees, and lack of trust in peer-to-peer energy sharing.

## ✨ Features

⚡ Discover and reserve charging stations globally via a decentralized registry  
💰 Tokenize energy units (kWh) for seamless, instant payments without fiat conversions  
🌍 Cross-border compatibility with no currency barriers  
🔒 Secure escrow for payments, released only after charging completion  
📊 Real-time availability and pricing updates via oracles  
⭐ User ratings and reviews for trustworthy stations  
🛡️ Dispute resolution mechanism for fair outcomes  
🏛️ DAO governance for community-driven upgrades  

## 🛠 How It Works

**For EV Owners (Drivers)**  

- Register your wallet and vehicle details on the platform.  
- Search for nearby charging stations using the registry.  
- Reserve a slot by locking energy tokens in escrow.  
- Start charging; the system verifies completion via oracle data.  
- Tokens are released to the station owner upon success—rate the experience afterward!  

**For Charging Station Owners**  

- Register your station with location, capacity, and pricing details.  
- Set availability and accept reservations.  
- Receive tokenized payments automatically after charging sessions.  
- Build reputation through user reviews; participate in governance for platform improvements.  

**For Verifiers and Governance**  

- Use query functions to check station details, user ratings, or token balances.  
- In disputes (e.g., failed charging), submit evidence to the resolution contract for arbitration.  
- Token holders can vote on proposals via the DAO for features like fee adjustments or oracle integrations.  

That's it! A truly decentralized, efficient EV charging ecosystem powered by blockchain.

## 📜 Smart Contracts

This project is built using Clarity on the Stacks blockchain and involves 8 smart contracts for modularity, security, and scalability:  

1. **UserRegistry.clar**: Handles user registration, profile management, and vehicle verification to ensure trusted participants.  
2. **StationRegistry.clar**: Manages charging station listings, including location data, capacity, and owner details; prevents duplicates.  
3. **EnergyToken.clar**: A fungible token contract (similar to SIP-10) for minting, transferring, and burning kWh-based energy units.  
4. **ReservationSystem.clar**: Allows booking of charging slots, with time-based locks and cancellations.  
5. **PaymentEscrow.clar**: Secures token escrows for sessions, releasing funds only after oracle-confirmed completion.  
6. **OracleIntegration.clar**: Fetches real-world data like energy delivery confirmation, pricing feeds, or availability updates.  
7. **RatingReview.clar**: Stores and queries user feedback, calculating reputation scores for stations and owners.  
8. **DisputeGovernance.clar**: Combines dispute resolution logic with DAO voting for community decisions and arbitration outcomes.