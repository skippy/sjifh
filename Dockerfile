FROM mcr.microsoft.com/playwright:next

RUN apt-get update && \
	curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
	apt-get install -y nodejs

WORKDIR /usr/src/app

# this makes builds much faster
COPY package*.json ./
RUN npm install

COPY . .

#ARG SHOPIFY_API_KEY
#ENV SHOPIFY_API_KEY=$SHOPIFY_API_KEY

#RUN npm install

# Set the command to run your application
#CMD ["yarn", "start"]

